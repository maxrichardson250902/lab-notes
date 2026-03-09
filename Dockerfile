FROM python:3.12-slim
RUN apt-get update && apt-get install -y rclone && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN python build.py
EXPOSE 3003
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3003"]
