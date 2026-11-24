# حبيبة الأقصى - إدارة أتيليه تأجير الفساتين

Web app (Arabic, RTL, mobile-first). Node >= 22.5, zero npm dependencies, SQLite database.

## Run
    node server.js            # http://localhost:3000
Env: PORT, DATA_DIR (where atelier.db lives - must be persistent storage), OWNER_PASSWORD, STAFF_PASSWORD (first run only), NODE_ENV=production (secure cookie, needs HTTPS).

Default logins on first run: owner / owner123, staff / staff123 -> change from المزيد > الحسابات وكلمات السر.

Demo data (testing only): `node seed-demo.js` against a fresh server.

## Deploy notes
The database is one file at DATA_DIR/atelier.db (photos are stored inside it). Hosting must keep that folder between restarts
(a persistent disk/volume). Hosts with ephemeral disks (free Render web services, Heroku) will lose data on restart.
Back up by copying atelier.db.
