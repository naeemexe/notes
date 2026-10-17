# Notes

Notion-style block notes + OneNote-style handwriting. Built for Mac (typing) and iPad + Apple Pencil (writing).

## Run it

```bash
npm start
```

This builds the app and starts the notes server. It prints two URLs:

- **Mac:** http://localhost:5180
- **iPad:** http://<your-mac-ip>:5180 (iPad must be on the same Wi-Fi). Or use `http://Naeems-MacBook-Air.local:5180`.

On iPad: open the URL in Safari → Share → **Add to Home Screen**. It opens full-screen like an app.

Your notes are saved as JSON files in `./data` on the Mac. Back up that folder.
The Mac has to be awake with the server running for the iPad to sync.

## Host it on the Windows laptop (https://notes.naeemislam.com)

1. Copy `notes-data.zip` (a zip of the Mac's `data/` folder) to the laptop's Downloads.
2. In PowerShell (not admin):
   ```powershell
   irm https://raw.githubusercontent.com/naeemexe/notes/main/scripts/setup-windows.ps1 -OutFile setup-notes.ps1
   powershell -ExecutionPolicy Bypass -File setup-notes.ps1 -DataZip "$HOME\Downloads\notes-data.zip"
   ```
   It installs Node, Git and cloudflared, clones to `~\notes`, imports the data, builds, runs the server and the
   Cloudflare Tunnel under pm2, starts both at login, and stops the laptop sleeping on power. A browser opens once
   to authorize Cloudflare: pick `naeemislam.com`. Windows may ask to allow Node on the network: allow it.
3. **Add a login** (the app has none): dash.cloudflare.com → Zero Trust → Access → Applications → Add →
   Self-hosted. Domain `notes.naeemislam.com`, session 1 month, policy Allow → Emails → your email. Login is an
   emailed one-time code.
4. iPad: open https://notes.naeemislam.com → log in → Share → Add to Home Screen.

Re-run the script to update after pulling new code. Check on it with `pm2 status` and `pm2 logs notes`.
Use one server at a time: once Windows hosts it, stop the Mac server so the two copies don't diverge.

## How it works

- **Typing:** works like Notion. Type `/` for headings, lists, to-dos, code, images, **Two/Three Columns**, **Drawing**.
  You can also drag a block (⋮⋮ handle) to the left or right edge of another block to put them side by side.
- **Writing:** Apple Pencil always draws, whatever tool is selected. Your finger scrolls (toggle ☝️ to let your finger draw).
  On the Mac pick the Pen (P), Highlighter (H) or Eraser (E). Press Esc or T to go back to typing.
- **Automatic drawing space:** put the pen anywhere in the empty area below your notes and a drawing starts there.
  Keep writing and it keeps growing, with no height limit. Click below it in Type mode to start a new text line.
- Drawing menu (⋯ on a drawing): trim empty space, clear, delete. Drag the bar under a drawing to resize it.
- ↶ undoes ink. Cmd+Z undoes text.
- Two devices: changes show up on the other device within ~4 seconds. If you edit the *same page* on both at
  the same moment, the last save wins.

## Dev

```bash
npm run server   # API on :5180
npm run dev      # Vite with hot reload on :5173 (proxies the API)
```

## Later: sharing with friends

Deploy `server.mjs` + `dist/` to any Node host with a persistent disk (Fly.io, Railway, a VPS) and set `DATA_DIR`.
Add login before sharing: there is no auth yet, so anyone who can reach the URL can read and edit.
