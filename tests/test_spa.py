
def test_spa_route_returns_fallback_message(client):
    response = client.get("/")
    assert response.status_code == 200
    body = response.get_data(as_text=True)
    fallback = "Build not found. Run Vite build to populate /dist."
    assert body == fallback or "<html" in body.lower()


def test_unknown_api_routes_return_404(client):
    response = client.get("/api/unknown")
    assert response.status_code == 404
    body = response.get_data(as_text=True)
    assert "Not Found" in body
