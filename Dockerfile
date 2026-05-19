# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /app

# Сначала только requirements — чтобы слой с зависимостями кешировался
# и не пересобирался при каждом изменении исходников.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Теперь весь проект (bot.py, database.py, webapp/, и т.д.).
COPY . .

# Папка для загрузок паспортных фото — должна существовать до старта.
RUN mkdir -p /app/uploads

ENV API_HOST=0.0.0.0 \
    API_PORT=3000 \
    PYTHONUNBUFFERED=1

EXPOSE 3000

CMD ["python", "bot.py"]
