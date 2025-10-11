# Stage 1: build the Vite frontend
FROM node:20 AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# Stage 2: run the Flask backend
FROM python:3.11-slim AS backend
WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV FLASK_PORT=8080

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .
COPY --from=frontend /app/dist ./dist

CMD ["python", "app.py"]
