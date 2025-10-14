
def test_api_endpoint_returns_success(client):
    response = client.get("/api/test")
    assert response.status_code == 200
    assert response.get_json() == {"message": "Flask backend is working!"}


def test_invite_info_endpoint_returns_session_metadata(client, monkeypatch):
    monkeypatch.setattr("app._send_email", lambda **_: True)

    owner_email = "owner@example.com"
    invite_email = "invitee@example.com"
    create_resp = client.post(
        "/api/sessions",
        json={
            "email": owner_email,
            "title": "Invite info",
            "requiredNames": 12,
            "nameFocus": "boy",
        },
    )
    assert create_resp.status_code == 200
    payload = create_resp.get_json()["session"]
    sid = payload["sid"]
    template_resp = client.post(
        f"/api/sessions/{sid}/lists",
        json={"email": owner_email, "names": [], "selfRanks": {}, "slotCount": 12},
    )
    assert template_resp.status_code == 200

    invite_resp = client.post(
        f"/api/sessions/{sid}/participants",
        json={"email": owner_email, "participants": [invite_email]},
    )
    assert invite_resp.status_code == 200
    invite_payload = invite_resp.get_json()
    assert invite_payload["ok"] is True
    token = invite_payload["results"][0]["link"].split("token=")[-1]

    info_resp = client.get(f"/api/invite-info?sid={sid}&token={token}")
    assert info_resp.status_code == 200
    info = info_resp.get_json()
    assert info["ok"] is True
    invite = info["invite"]
    assert invite["sid"] == sid
    assert invite["token"] == token
    assert invite["email"] == invite_email
    assert invite["requiredNames"] == 12
    assert invite["nameFocus"] == "boy"
    assert invite["title"] == "Invite info"
    assert invite["templateReady"] is True


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
        },
    )
    assert response.status_code == 200
    sid = response.get_json()["session"]["sid"]

    template_resp = client.post(
        f"/api/sessions/{sid}/lists",
        json={"email": owner_email, "names": [], "selfRanks": {}, "slotCount": 8},
    )
    assert template_resp.status_code == 200

    invite_resp = client.post(
        f"/api/sessions/{sid}/participants",
        json={"email": owner_email, "participants": [invitee_email]},
    )
    assert invite_resp.status_code == 200
    invite_payload = invite_resp.get_json()
    assert invite_payload["ok"] is True
    result_row = invite_payload["results"][0]
    assert result_row["email"] == invitee_email
    assert result_row["status"] == "invite-sent"
    assert result_row["emailSent"] is True
    assert "mode=signup" in result_row["link"]
    assert "email=guest%40example.com" in result_row["link"]

    assert sent_messages, "Expected invite email to be dispatched"
    assert sent_messages[0]["recipient"] == invitee_email
    assert "Family picks" in sent_messages[0]["body"]
    assert result_row["link"] in sent_messages[0]["body"]

    from app import SessionInvite, SessionLocal  # lazy import to use updated metadata

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
    assert "email=guest%40example.com" in pending[0]["link"]


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

    template_resp = client.post(
        f"/api/sessions/{sid}/lists",
        json={"email": owner_email, "names": [], "selfRanks": {}, "slotCount": 8},
    )
    assert template_resp.status_code == 200

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
    assert "email=participant%40example.com" in row["link"]

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


def test_joined_participant_receives_required_names_metadata(client, monkeypatch):
    monkeypatch.setattr("app._send_email", lambda **_: True)

    owner_email = "owner@example.com"
    joiner_email = "joiner@example.com"

    create_resp = client.post(
        "/api/sessions",
        json={
            "email": owner_email,
            "title": "Metadata session",
            "requiredNames": 16,
            "nameFocus": "girl",
        },
    )
    assert create_resp.status_code == 200
    sid = create_resp.get_json()["session"]["sid"]

    template_resp = client.post(
        f"/api/sessions/{sid}/lists",
        json={"email": owner_email, "names": [], "selfRanks": {}, "slotCount": 16},
    )
    assert template_resp.status_code == 200

    invite_resp = client.post(
        f"/api/sessions/{sid}/participants",
        json={"email": owner_email, "participants": [joiner_email]},
    )
    assert invite_resp.status_code == 200
    token = invite_resp.get_json()["results"][0]["link"].split("token=")[-1]

    # Join the session
    client.post(
        "/api/signup",
        json={"fullName": "Joiner", "email": joiner_email, "password": "Secret123"},
    )
    join_resp = client.post(
        "/api/sessions/join",
        json={"email": joiner_email, "token": token, "sid": sid},
    )
    assert join_resp.status_code == 200

    session_resp = client.get(f"/api/sessions/{sid}?email={joiner_email}")
    assert session_resp.status_code == 200
    session_doc = session_resp.get_json()["session"]
    assert session_doc["requiredNames"] == 16
    assert session_doc["nameFocus"] == "girl"


def test_inviting_before_template_ready_is_blocked(client):
    owner_email = "owner@example.com"
    invite_email = "friend@example.com"
    create_resp = client.post(
        "/api/sessions",
        json={"email": owner_email, "title": "Blocked", "requiredNames": 8, "nameFocus": "mix"},
    )
    assert create_resp.status_code == 200
    sid = create_resp.get_json()["session"]["sid"]

    invite_resp = client.post(
        f"/api/sessions/{sid}/participants",
        json={"email": owner_email, "participants": [invite_email]},
    )
    assert invite_resp.status_code == 409
    body = invite_resp.get_json()
    assert "template" in body["error"]
