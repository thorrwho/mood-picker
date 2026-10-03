# data/

Working files for growing the shelf. Nothing in here is read by the website.

```text
import  ->  candidates.json  ->  you review it  ->  merge  ->  lib/catalog.js
```

1. **Import** proposes titles from a dataset. It only knows facts (title, year, type, ids, votes). It leaves `dread`, `pace`, `tags` and `blurb` empty on purpose.
   - TMDB: `TMDB_API_KEY=... npm run import:tmdb`
   - IMDb files: download `title.basics.tsv.gz` and `title.ratings.tsv.gz` from <https://datasets.imdbws.com/> into `data/downloads/`, then
     `npm run import:imdb -- --basics data/downloads/title.basics.tsv.gz --ratings data/downloads/title.ratings.tsv.gz`
2. **Review** `data/candidates.json`. For each title you want: set `dread` (1 to 5), `pace`, at least two `tags`, and write the `blurb` (a one-line premise) **in your own words**. Add `where` only if you are sure. Then set `"approved": true`. See [`approved.example.json`](approved.example.json).
3. **Merge**: `npm run merge:dry` shows what would be added, `npm run merge` adds it. If any approved entry is invalid, **nothing** is written and every problem is listed. Then `npm test`.

`candidates.json` and `downloads/` are git-ignored: they contain third-party data (TMDB descriptions, IMDb files) that should not be committed.

## Rules the merge step enforces

Same rules as the test-suite: unique id, a title+year not already on the shelf, a year from 1895 to this year, `dread` 1 to 5, `pace` slow/medium/fast, 2+ known tags, a 20 to 200 character premise that is **not a copy of the TMDB description**, films/series `where` only Netflix / Prime Video / SonyLIV (India), games `where` only platforms.

## Be honest about dread

The scare-level slider depends on `dread`: it aims for the chosen level and the one below it. When unsure, round **up**: a gentle label on a brutal film is a worse mistake than the reverse.

## Data terms

TMDB is free for non-commercial use with attribution (and its watch-provider data must credit JustWatch). The IMDb files are for personal, non-commercial use only. If this ever stops being a free portfolio project, re-read both sets of terms first.
