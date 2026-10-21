# Archived: the Node.js + SQL Server version

This folder holds the first version of the system (Express server + SQL Server). It is no longer used - the project is now plain HTML, CSS and browser JavaScript (see the README one level up).

It is kept only so nothing is lost. To run it again you would need Node.js and SQL Server: `npm install`, fill in `.env.development` / `.env.production`, `npm run setup-db`, `npm run dev`. That version expects the `public/` folder to be served by its server, and `public/` now talks to the browser-side backend instead, so you would need the older `public/` from Git history.

You can delete this folder whenever you are happy with the new version. The two SQL Server databases (`LorDeCambodgeDB`, `LorDeCambodgeDB_Dev`) and their logins (`lodc_app`, `lodc_dev`) still exist on your PC; drop them in SSMS if you no longer want them.
