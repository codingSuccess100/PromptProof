# Deploy (about 10 minutes)

The app is a standard Next.js project. Vercel is the shortest path. Any Node host works.

## 1. Put the code on GitHub

The folder is already a git repository with one commit.

```
gh repo create promptproof --public --source=. --push
```

No GitHub CLI? Create an empty public repo at https://github.com/new, then:

```
git remote add origin https://github.com/YOUR_USERNAME/promptproof.git
git push -u origin main
```

`.env.local` is git-ignored. Confirm with `git status` that it is not listed before pushing.

## 2. Deploy on Vercel

1. Go to https://vercel.com/new and import the repo. Leave every build setting on its default.
2. Under Environment Variables add:
   - `OPENAI_API_KEY` = your key
   - `OPENAI_MODEL` = the model named in your report (default `gpt-6-luna`)
   - `MAX_PARALLEL` = the value recommended in your report
3. Click Deploy.

Command-line alternative:

```
npx vercel
npx vercel env add OPENAI_API_KEY production
npx vercel --prod
```

## 3. Verify the deployed site

1. Open the URL. The badge in the header must show the model name, not "Offline mock model".
2. Run Task 1 with the weak prompt, then the strong prompt.
3. Wait for the X-ray table to appear.

If the X-ray fails only on the deployed site, the usual cause is the function time limit. `src/app/api/xray/route.ts` sets `maxDuration = 60`, which Vercel's free plan allows. Lower `MAX_PARALLEL` if you see rate limit errors.

## 4. Protect the key

- At https://platform.openai.com/settings/organization/limits set a low monthly budget.
- Create the key as a project key so it can be revoked without touching anything else.
- The API routes limit each device to 30 runs and 12 X-rays per 10 minutes. This is best effort.
- After judging, delete the key.
