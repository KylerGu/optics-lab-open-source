FROM node:22.23.4-alpine AS website
RUN apk add --no-cache --upgrade ca-certificates && update-ca-certificates
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM python:3.13-slim AS runtime
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=10000
COPY requirements.txt ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --uid 10001 --create-home optics
COPY backend ./backend
COPY src/sceneDefinitions.json src/opticsFormulas.json src/lensTeachingPresets.json ./src/
COPY --from=website /build/dist ./dist
USER optics
EXPOSE 10000
CMD ["python", "-m", "backend.web"]
