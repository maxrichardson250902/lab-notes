FROM python:3.12-slim
# rclone (Google Drive sync), openssh-client (LLM host), chromium (headless PDF rendering for backups).
# Chromium fonts + shared libs are needed to render text correctly in headless mode.
RUN apt-get update && apt-get install -y --no-install-recommends \
    rclone openssh-client \
    chromium fonts-liberation fonts-dejavu-core \
    libnss3 libxss1 libasound2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN python build.py
EXPOSE 3003
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3003", "--workers", "4"]
