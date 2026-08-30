FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PDF_INDEX_DATA_DIR=/data \
    PAGEINDEX_ADAPTER=fixture \
    PAGEINDEX_VENDOR_ROOT=/opt/pageindex \
    PAGEINDEX_SHADOW_FONT_FILE=/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc

RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml README.md ./
COPY app ./app
RUN pip install --no-cache-dir .
RUN mkdir -p /data /opt/pageindex

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
