#!/usr/bin/env node
import {readFileSync, appendFileSync} from 'fs';
import yargs from 'yargs';

// Usage: `yarn leagues-to-markdown [season]`
const season = yargs.parse()._[0];

// Read the source JSON
const json = JSON.parse(readFileSync(`./data/${season}/leagues.json`, 'utf-8'));

// Convert to markdown links
let content = [];
Object.keys(json.leagues).forEach(tier => {
    content.push(`\n### ${tier}\n`);
    json.leagues[tier].forEach(league => {
        content.push(`- [${league.name}](${league.url})`);
    });
});

// Append to file
appendFileSync(`./data/${season}/${season}.md`, content.join('\n'), 'utf-8');
