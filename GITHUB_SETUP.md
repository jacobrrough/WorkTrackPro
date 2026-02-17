# How to Upload Your App to GitHub (Complete Beginner's Guide)

**Why GitHub?** Both Vercel and Railway need your code on GitHub to deploy it automatically.

**Time needed:** 10-15 minutes

---

## Part 1: Install Git (If You Don't Have It)

### Check if Git is Already Installed

1. Open **Command Prompt** (Windows)
   - Press `Win + R`, type `cmd`, press Enter
   - OR press `Win + X` and choose "Command Prompt" or "Windows PowerShell"

2. Type this command and press Enter:
   ```
   git --version
   ```

3. **If you see a version number** (like `git version 2.40.0`): ✅ Git is installed! Skip to Part 2.

4. **If you see an error** (like "'git' is not recognized"): You need to install Git.

### Install Git (If Needed)

**For Windows:**
1. Go to **https://git-scm.com/download/win**
2. Download the installer (it will auto-detect 64-bit)
3. Run the installer
4. Click "Next" through all screens (default settings are fine)
5. Click "Install"
6. When done, **close and reopen Command Prompt** (important!)
7. Type `git --version` again to verify

---

## Part 2: Create a GitHub Account

1. Go to **https://github.com**
2. Click **"Sign up"** (top right)
3. Enter:
   - **Username:** (choose something like `yourname` or `roughcutmfg`)
   - **Email:** (your email address)
   - **Password:** (create a strong password)
4. Solve the puzzle/verification
5. Click **"Create account"**
6. Verify your email (check your inbox, click the verification link)
7. Choose **"Free"** plan (it's free forever)
8. Skip the questions (or answer if you want)
9. You're now logged into GitHub! ✅

---

## Part 3: Create a Repository on GitHub

**What is a repository?** It's like a folder on GitHub where your code lives.

1. Once logged into GitHub, click the **"+"** icon (top right)
2. Click **"New repository"**
3. Fill in:
   - **Repository name:** `WorkTrackPro` (or `WorkTrackPro_V6` - whatever you want)
   - **Description:** (optional) "WorkTrack Pro - Manufacturing management app"
   - **Visibility:** Choose **☑️ Public** (free) or **Private** (if you want it hidden)
   - **DO NOT** check "Add a README file" (we'll add your existing code)
   - **DO NOT** add .gitignore or license (you already have these)
4. Click **"Create repository"**

**You'll see a page with setup instructions - DON'T follow those yet!** We'll do it differently.

---

## Part 4: Upload Your Code to GitHub

### Step 1: Open Your Project Folder in Command Prompt/Terminal

**Option A: Easy Way (Windows)**
1. Open File Explorer
2. Navigate to your project folder: `C:\Users\jrrou\WorkTrackPro_V6`
3. Click in the address bar (where it shows the path)
4. Type `cmd` and press Enter
5. Command Prompt opens in that folder! ✅

**Option B: Manual Way**
1. Open Command Prompt/Terminal
2. Type: `cd C:\Users\jrrou\WorkTrackPro_V6` (Windows) or `cd ~/path/to/WorkTrackPro_V6` (Mac)
3. Press Enter

**Verify you're in the right place:**
- Type: `dir` and press Enter
- You should see files like `package.json`, `src`, `PocketBaseServer`, etc.

### Step 2: Initialize Git (If Not Already Done)

1. Type this command:
   ```
   git init
   ```
2. Press Enter
3. You should see: "Initialized empty Git repository..."

**If you see "Reinitialized existing Git repository"** - that's fine! Git is already set up.

### Step 3: Add All Your Files

1. Type this command:
   ```
   git add .
   ```
2. Press Enter
3. (No output is normal - it worked!)

**What this does:** Tells Git to track all your files.

### Step 4: Make Your First Commit

1. Type this command:
   ```
   git commit -m "Initial commit - WorkTrack Pro app"
   ```
2. Press Enter
3. You might see a message about configuring your name/email first - see "Configure Git" below

**What this does:** Saves a snapshot of your code.

### Step 5: Configure Git (If Needed)

**If you see a message about name/email, do this:**

1. Type (replace with YOUR name and email):
   ```
   git config --global user.name "Your Name"
   ```
   Press Enter
   
2. Then type:
   ```
   git config --global user.email "your.email@example.com"
   ```
   Press Enter
   
3. Then run the commit command again:
   ```
   git commit -m "Initial commit - WorkTrack Pro app"
   ```
   Press Enter

### Step 6: Connect to GitHub

1. Go back to GitHub (in your browser)
2. Go to the repository you created (click your username → repositories → your repo name)
3. You'll see a page with setup instructions
4. Look for the section **"…or push an existing repository from the command line"**
5. Copy the commands shown (they look like this):

```
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git branch -M main
git push -u origin main
```

**BUT WAIT** - Don't run them yet! We'll do it step by step.

### Step 7: Add GitHub as Remote

1. In your Command Prompt (still in your project folder)
2. Type this command (replace `YOUR-USERNAME` and `YOUR-REPO-NAME` with your actual GitHub username and repo name):
   ```
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
   ```
3. Press Enter
4. (No output means it worked!)

**Example:** If your username is `johnsmith` and repo is `WorkTrackPro`, the command would be:
```
git remote add origin https://github.com/johnsmith/WorkTrackPro.git
```

### Step 8: Rename Branch to Main

1. Type:
   ```
   git branch -M main
   ```
2. Press Enter

### Step 9: Push Your Code to GitHub

1. Type:
   ```
   git push -u origin main
   ```
2. Press Enter
3. **You'll be asked for credentials:**
   - **Username:** Your GitHub username
   - **Password:** You need a **Personal Access Token** (not your GitHub password!)

**Wait - you need to create a Personal Access Token first!**

---

## Part 5: Create Personal Access Token (For Authentication)

GitHub doesn't let you use your password anymore. You need a token.

### Step 1: Create Token on GitHub

1. In GitHub (browser), click your **profile picture** (top right)
2. Click **"Settings"**
3. Scroll down in left sidebar, click **"Developer settings"**
4. Click **"Personal access tokens"** → **"Tokens (classic)"**
5. Click **"Generate new token"** → **"Generate new token (classic)"**
6. Fill in:
   - **Note:** "WorkTrack Pro Upload" (or anything)
   - **Expiration:** Choose "90 days" or "No expiration" (your choice)
   - **Scopes:** Check **☑️ repo** (this gives full repository access)
7. Scroll down, click **"Generate token"**
8. **IMPORTANT:** Copy the token immediately! It looks like: `ghp_xxxxxxxxxxxxxxxxxxxx`
9. **Save it somewhere safe** - you won't see it again!

### Step 2: Use Token to Push

1. Go back to Command Prompt
2. Run the push command again:
   ```
   git push -u origin main
   ```
3. When asked for **Username:** Enter your GitHub username and press Enter
4. When asked for **Password:** Paste the token you just copied (it won't show as you type - that's normal!)
5. Press Enter
6. Wait 30-60 seconds - you'll see progress bars
7. When you see "Branch 'main' set up to track 'origin/main'" - **SUCCESS!** ✅

---

## Part 6: Verify Your Code is on GitHub

1. Go to GitHub in your browser
2. Go to your repository (click your username → repositories → your repo name)
3. You should see all your files:
   - `package.json`
   - `src/` folder
   - `PocketBaseServer/` folder
   - `README.md`
   - etc.

**✅ Your code is now on GitHub!**

---

## ✅ Checklist

- [ ] Git installed (`git --version` works)
- [ ] GitHub account created
- [ ] Repository created on GitHub
- [ ] Git initialized in project folder (`git init`)
- [ ] Files added (`git add .`)
- [ ] First commit made (`git commit`)
- [ ] GitHub remote added (`git remote add origin`)
- [ ] Personal access token created
- [ ] Code pushed to GitHub (`git push`)
- [ ] Can see files on GitHub website

---

## 🆘 Troubleshooting

### "git: command not found"

**Fix:** Git isn't installed. Go back to Part 1 and install Git.

### "fatal: not a git repository"

**Fix:** You're not in your project folder. 
1. Type: `cd C:\Users\jrrou\WorkTrackPro_V6`
2. Press Enter
3. Then try your git command again

### "remote origin already exists"

**Fix:** The remote is already set up. Skip Step 7 and go to Step 9.

### "Authentication failed" or "Invalid credentials"

**Fix:**
1. Make sure you're using the **Personal Access Token** (not your password)
2. Make sure you copied the entire token (starts with `ghp_`)
3. Try creating a new token with "repo" scope checked

### "Permission denied" or "Repository not found"

**Fix:**
1. Check that your GitHub username and repo name are correct
2. Make sure the repository exists on GitHub
3. Verify the token has "repo" scope

### "Everything up-to-date" but files aren't on GitHub

**Fix:**
1. Make sure you ran `git add .` before commit
2. Make sure you committed (`git commit`)
3. Check that you're pushing to the right branch (`git push -u origin main`)

### "bash: command not found" or commands don't work

**Fix:** You're on Windows, so use **Command Prompt** (cmd.exe), not bash. 
- Press `Win + R`, type `cmd`, press Enter
- All commands should work in Command Prompt
- If you're using PowerShell, the commands are the same

---

## 🔄 Updating Your Code Later

**When you make changes to your code:**

1. Open Command Prompt in your project folder
2. Run these commands one at a time:
   ```
   git add .
   ```
   Press Enter, then:
   ```
   git commit -m "Description of what you changed"
   ```
   Press Enter, then:
   ```
   git push
   ```
   Press Enter
3. Your changes will be uploaded to GitHub!

**Example:**
```
git add .
```
(Press Enter)
```
git commit -m "Added quotes feature"
```
(Press Enter)
```
git push
```
(Press Enter)

---

## 🎉 You're Done!

Your code is now on GitHub and ready for deployment!

**Next steps:**
- Follow the `DEPLOYMENT.md` guide to deploy to Vercel and Railway
- Both services will automatically use your GitHub repository

**Need help?** Check the troubleshooting section above, or make sure you followed each step exactly.
