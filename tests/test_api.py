
def test_api_endpoint_returns_success(client):
    response = client.get("/api/test")
    assert response.status_code == 200
    assert response.get_json() == {"message": "Flask backend is working!"}


def test_signup_rejects_invalid_email(client):
    response = client.post(
        "/api/signup",
        json={"fullName": "Tester", "email": "invalid-email", "password": "Secret123"},
    )
    assert response.status_code == 400
    body = response.get_json()
    assert body["error"] == "Invalid email address"


def test_password_reset_flow(client):
    email = "user@example.com"
    response = client.post(
        "/api/signup",
        json={"fullName": "Tester", "email": email, "password": "Secret123"},
    )
    assert response.status_code == 200

    request_resp = client.post("/api/reset-password-request", json={"email": email})
    assert request_resp.status_code == 200
    reset_payload = request_resp.get_json()
    assert reset_payload["ok"] is True
    token = reset_payload["token"]
    assert token

    confirm_resp = client.post(
        "/api/reset-password",
        json={"token": token, "newPassword": "NewSecret123"},
    )
    assert confirm_resp.status_code == 200
    assert confirm_resp.get_json()["ok"] is True

    login_resp = client.post("/api/login", json={"email": email, "password": "NewSecret123"})
    assert login_resp.status_code == 200


def test_reset_request_handles_unknown_email_gracefully(client):
    response = client.post("/api/reset-password-request", json={"email": "nobody@example.com"})
    assert response.status_code == 200
    assert response.get_json()["ok"] is True


def test_reset_request_rejects_bad_email_format(client):
    response = client.post("/api/reset-password-request", json={"email": "bad"})
    assert response.status_code == 400


def test_inviting_new_participant_sends_email_and_tracks_pending_invite(client, monkeypatch):
    sent_messages = []

    def fake_send_email(*, subject, body, html_body, recipient):
        sent_messages.append(
            {
                "subject": subject,
                "body": body,
                "html": html_body,
                "recipient": recipient,
            }
        )
        return True

    monkeypatch.setattr("app._send_email", fake_send_email)

    owner_email = "owner@example.com"
    invitee_email = "guest@example.com"
    response = client.post(
        "/api/sessions",
        json={
            "email": owner_email,
            "title": "Family picks",
            "requiredNames": 8,
            "nameFocus": "mix",
            "invites": [invitee_email],
        },
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True

    session_data = payload["session"]
    assert session_data["invites"][0]["email"] == invitee_email
    assert session_data["invites"][0]["emailSent"] is True
    assert "mode=signup" in session_data["invites"][0]["link"]

    assert sent_messages, "Expected invite email to be dispatched"
    assert sent_messages[0]["recipient"] == invitee_email
    assert "Family picks" in sent_messages[0]["body"]
    assert session_data["invites"][0]["link"] in sent_messages[0]["body"]

    from app import SessionInvite, SessionLocal  # lazy import to use updated metadata

    sid = session_data["sid"]
    db = SessionLocal()
    try:
        invites = db.query(SessionInvite).filter_by(session_id=sid).all()
        assert len(invites) == 1
        assert invites[0].email == invitee_email
    finally:
        db.close()

    session_response = client.get(f"/api/sessions/{sid}?email={owner_email}")
    assert session_response.status_code == 200
    session_payload = session_response.get_json()
    pending = session_payload["session"].get("pendingInvites") or []
    assert any(inv["email"] == invitee_email for inv in pending)
    assert pending[0]["link"]
    assert "mode=signup" in pending[0]["link"]


def test_inviting_existing_user_sends_notification_email(client, monkeypatch):
    sent_messages = []

    def fake_send_email(*, subject, body, html_body, recipient):
        sent_messages.append({"recipient": recipient, "subject": subject, "body": body})
        return True

    monkeypatch.setattr("app._send_email", fake_send_email)

    participant_email = "participant@example.com"
    owner_email = "owner@example.com"

    signup_resp = client.post(
        "/api/signup",
        json={"fullName": "Participant", "email": participant_email, "password": "Secret123"},
    )
    assert signup_resp.status_code == 200

    session_resp = client.post(
        "/api/sessions",
        json={"email": owner_email, "title": "Test session", "requiredNames": 8, "nameFocus": "mix"},
    )
    assert session_resp.status_code == 200
    sid = session_resp.get_json()["session"]["sid"]

    sent_messages.clear()
    invite_resp = client.post(
        f"/api/sessions/{sid}/participants",
        json={"email": owner_email, "participants": [participant_email]},
    )
    assert invite_resp.status_code == 200
    invite_payload = invite_resp.get_json()
    assert invite_payload["ok"] is True
    row = invite_payload["results"][0]
    assert row["status"] == "added"
    assert row["emailSent"] is True
    assert "mode=signin" in row["link"]

    assert any(msg["recipient"] == participant_email for msg in sent_messages)

    from app import Member, SessionInvite, SessionLocal

    db = SessionLocal()
    try:
        membership = db.query(Member).filter_by(session_id=sid, uid=participant_email).first()
        assert membership is not None
        pending = db.query(SessionInvite).filter_by(session_id=sid, email=participant_email).all()
        assert pending == []
    finally:
        db.close()

    session_view = client.get(f"/api/sessions/{sid}?email={owner_email}")
    assert session_view.status_code == 200
    session_doc = session_view.get_json()["session"]
    assert participant_email in session_doc["participantIds"]
    assert not session_doc.get("pendingInvites")
