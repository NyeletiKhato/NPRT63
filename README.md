# NPRT63

## NPRT63 - Project

[![Code License](https://img.shields.io/badge/Code%20License-GPLv2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Follow%20%40iammelvink-blue.svg?style=social&logo=linkedin)](https://www.linkedin.com/in/iammelvink)

## Overview

This is a Library Management System with a React frontend and a Node.js (Express + SQLite) backend. It supports role-based access, catalogue management, borrowing and returns, fines, reservations, reports, reading recommendations, and in-app notifications.

## Run locally

```sh
npm install
npm run dev       # React development server and Node API
```

Open `http://127.0.0.1:5173/static/react/`. The development command starts both
the React site and the borrowing API, so catalogue actions such as **Borrow** work
without a second terminal.

### Phone access QR code

The landing page includes a QR code that opens the current library URL on a phone.
For local testing, connect the computer and phone to the same Wi-Fi network, start
`npm run dev`, then open the site on the computer using its LAN address (for example,
`http://192.168.1.25:5173/static/react/`) before scanning. The QR code will then
contain that phone-reachable address. In production it automatically uses the public
site address. You can also set `VITE_LIBRARY_URL` to explicitly choose the URL the
QR code contains.

For production, run `npm run build` and then `npm start`.

The Node/Express backend in `backend/server.js` is the active application backend. The Django directory is retained only as a legacy data source for the optional migration command; it is not required to run the application.

### Password reset

Use **Forgot password?** on the member login screen. In development, the one-time reset code is shown in the interface and server terminal; it expires after 15 minutes. Before deploying publicly, connect this flow to an email provider and set `NODE_ENV=production`, `SESSION_SECRET`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD`.

The API uses cookie sessions. On a new database, the server creates `admin` / `admin123`; configure `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET` before deploying.

To retain the existing Django SQLite data, run `npm run migrate-django-data` before the first Node server start. Existing Django PBKDF2 passwords remain valid and are upgraded to bcrypt after a successful login.

Written with React, Vite, Express, SQLite, and bcrypt.

1. Methodologies/Project Management:

   - Agile

2. Coding Practices:

   - OOP (Object Oriented Programming)
   - MVC (Model View Controller)

3. Programming Languages/Frameworks:

   - JavaScript, React, Node.js, Express, SQLite

## Instructions

1. Make sure you have these installed

2. Clone `ONLY THE LATEST COMMIT` of this repository into your local machine using the terminal (mac) or
   [Gitbash (PC)](https://git-scm.com/download/win 'Gitbash (PC)') `to save storage space`

   ```sh
   git clone https://github.com/iammelvink/NPRT63.git --depth=1
   ```

## Author(s)

"Group members and lecturer"

[Melvin Kisten](https://github.com/iammelvink 'Melvin Kisten\'s GitHub page')

GitHub: @"Group members"

LinkedIn: [Melvin Kisten](https://www.linkedin.com/in/iammelvink 'Melvin Kisten\'s LinkedIn page')

## Acknowledgments

To my lecturer [Melvin Kisten](https://www.linkedin.com/in/iammelvink 'Melvin Kisten\'s LinkedIn page') for their guidance

## More Stuff

Check out some other stuff on
[Melvin Kisten](https://github.com/iammelvink 'Melvin Kisten\'s GitHub page')
