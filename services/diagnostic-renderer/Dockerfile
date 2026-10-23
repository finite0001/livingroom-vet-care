FROM mcr.microsoft.com/playwright@sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7
USER root
RUN apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update -qq \
 && apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 install -y --no-install-recommends qpdf=11.9.0-1.1ubuntu0.1 poppler-utils fonts-noto-core sudo \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --uid 12001 --create-home --shell /usr/sbin/nologin lrv-render && mkdir -p /home/lrv-render/work && chown -R lrv-render:lrv-render /home/lrv-render
WORKDIR /opt/lrv-renderer
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev
RUN sed -i 's/^hosts:.*/hosts: files/' /etc/nsswitch.conf
COPY worker.mjs pdf_admission.py ./
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production
ENV TZ=UTC
ENV LANG=C.UTF-8
USER root
CMD ["node", "/opt/lrv-renderer/worker.mjs"]
