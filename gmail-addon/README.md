# WorkTrack Card Creator — Gmail Add-on

Create kanban board cards directly from Gmail emails, including attachments.

## Setup

### 1. Netlify Environment Variables

Add these to your Netlify site (Site settings > Environment variables):

| Variable | Description |
|----------|-------------|
| `GMAIL_ADDON_API_KEY` | A random secret string (generate one: `openssl rand -hex 32`) |
| `GMAIL_ADDON_USER_ID` | (Optional) A Supabase user UUID to scope which boards appear in the add-on. If omitted, all boards are shown. |

> `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` should already be set.

### 2. Deploy Netlify Functions

Push to your repo — Netlify auto-deploys the two new functions:
- `/.netlify/functions/boards-for-addon` (GET)
- `/.netlify/functions/create-card-from-email` (POST)

### 3. Create the Google Apps Script Project

1. Go to [script.google.com](https://script.google.com) and create a new project
2. Name it "WorkTrack Card Creator"
3. Delete the default `Code.gs` content
4. Create these files and paste the corresponding content from this directory:
   - `Code.gs`
   - `Api.gs`
5. Replace the default `appsscript.json`:
   - In the editor, click the gear icon (Project settings)
   - Check "Show appsscript.json manifest file in editor"
   - Go back to the Editor and replace `appsscript.json` with the content from this directory

### 4. Configure Script Properties

In the Apps Script editor:
1. Click the gear icon (Project settings)
2. Scroll to "Script properties" and add:

| Property | Value |
|----------|-------|
| `API_KEY` | Same value as your `GMAIL_ADDON_API_KEY` in Netlify |
| `API_BASE_URL` | Your Netlify site URL, e.g. `https://your-app.netlify.app` |

### 5. Test the Add-on

1. In the Apps Script editor, click **Deploy > Test deployments**
2. Click **Install** next to "Gmail"
3. Open Gmail and open any email — you should see the add-on sidebar
4. Select a board and column, optionally check attachments, and click **Create Card**

### 6. Deploy for Your Workspace (Optional)

For a permanent internal deployment:
1. Click **Deploy > New deployment**
2. Select type: **Add-on**
3. Fill in the description and click **Deploy**
4. Share the deployment with your Google Workspace users

## How It Works

```
Gmail (open email)
  └── Add-on sidebar appears
        ├── Shows email subject, sender, body preview
        ├── Board dropdown (fetched from your app)
        ├── Column dropdown (grouped by board)
        └── Attachment checkboxes
              │
              ▼  Click "Create Card"
        Netlify Function: create-card-from-email
              ├── Creates board_cards row in Supabase
              ├── Uploads attachments to Supabase Storage
              └── Inserts attachments rows
              │
              ▼
        Card appears on your board in WorkTrackPro
```

## Limitations

- Individual attachments must be under 5 MB
- Up to 10 attachments per card creation
- Email body is truncated to 2,000 characters
- The add-on fetches boards when you open an email (slight delay on first load)
