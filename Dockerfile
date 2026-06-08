# kurdiovsky.cz — statický web + rezervační API (Node, bez závislostí)
FROM node:20-alpine

WORKDIR /app

# žádné npm install — žádné runtime závislosti (jen Node std knihovna)
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY admin ./admin
COPY assets ./assets
# jen produkční stránky (archivní varianty a.html/b.html/c.html/varianty.html se nenasazují)
COPY index.html sluzby.html o-mne.html rezervace.html kontakt.html portal.html ochrana-osobnich-udaju.html ./

ENV NODE_ENV=production
ENV PORT=3000
# rezervace + obsah CMS na persistent volume (Coolify: mount /data)
ENV BOOKINGS_DIR=/data/bookings
ENV CMS_DIR=/data/cms
ENV UPLOADS_DIR=/data/cms/uploads
ENV ADMIN_DATA_DIR=/data/admin
# tajné hodnoty (OPENROUTER_API_KEY, ADMIN_PASSWORD, SESSION_SECRET, TELEGRAM_*) se nastavují v Coolify env, NE zde

EXPOSE 3000

# rezervace přežijí restart i redeploy
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
