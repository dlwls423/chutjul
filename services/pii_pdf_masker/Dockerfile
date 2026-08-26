FROM python:3.12-slim
WORKDIR /service
COPY pyproject.toml .
RUN pip install --no-cache-dir .
COPY app ./app
ENV PORT=8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
