
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
