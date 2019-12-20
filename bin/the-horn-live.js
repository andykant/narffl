import {readFileSync} from 'fs';
import fetch from 'node-fetch';
import cron from 'cron';
import snoowrap from 'snoowrap';
import dotenv from 'dotenv-defaults';
dotenv.config();

const {CronJob} = cron;
const {
    SEASON,
    REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET,
    REDDIT_USERNAME,
    REDDIT_PASSWORD,
    REDDIT_THING_ID,
} = process.env;

// Fetch an individual week scoreboard for a given league.
async function fetchScoreboard({id, week}) {
    const response = await fetch(
        `https://www.fleaflicker.com/api/FetchLeagueScoreboard?sport=NFL&league_id=${id}&season=${SEASON}&scoring_period=${week}`
    );
    const body = await response.json();
    return body;
}

// Add THPP component values.
function updateTHPP(thpp) {
    thpp.total = Number((thpp.average + thpp.week15 + thpp.week16).toFixed(2));
    return thpp.total;
}

(async function main() {
    // Grab the list of premier leagues.
    const leagues = JSON.parse(
        readFileSync(`./data/${SEASON}/leagues.json`, 'utf-8')
    ).leagues.Premier.map(({name, url}) => ({
        name,
        id: parseInt(url.match(/leagues\/(\d+)/)[1], 10),
    }));

    // Retrieve championship teams.
    const teams = [];
    await Promise.all(
        leagues.map(async ({id, name}) => {
            const scoreboard = await fetchScoreboard({id, week: 16});
            const game = scoreboard.games.find(game => game.isChampionshipGame);
            game.away.league = name;
            game.home.league = name;
            teams.push(game.away);
            teams.push(game.home);
        })
    );

    // Retrieve regular season average and week 15 scores.
    await Promise.all(
        leagues.map(async ({id}) => {
            // Grab the games with championship teams.
            const scoreboard = await fetchScoreboard({id, week: 15});
            const games = scoreboard.games.filter(game =>
                teams.find(team => team.id === game.away.id || team.id === game.home.id)
            );

            // Cache average and week 15 scores.
            games.forEach(game => {
                const side = teams.find(team => team.id === game.home.id) ? 'home' : 'away';
                const team = teams.find(team => team.id === game[side].id);

                // Compute THPP values.
                team.thpp = {
                    average: Number(((team.pointsFor.value / 13) * 0.5).toFixed(2)),
                    week15: game[`${side}Score`].score.value,
                    week16: 0,
                };
                updateTHPP(team.thpp);
            });
        })
    );

    // Create reddit updater.
    async function updateRedditPost() {
        // Retrieve Week 16 statuses.
        console.log(`${Date.now()} Retrieving week 16 stats.`);
        await Promise.all(
            leagues.map(async ({id}) => {
                // Grab the games with championship teams.
                const scoreboard = await fetchScoreboard({id, week: 16});
                const game = scoreboard.games.find(game => game.isChampionshipGame);

                // Cache week 16 status.
                const awayTeam = teams.find(team => team.id === game.away.id);
                awayTeam.thpp.week16 = game.awayScore.score.value || 0;
                awayTeam.thpp.yetToPlay = game.awayScore.yetToPlay || 0;
                awayTeam.thpp.yetToPlayPositions = (game.awayScore.yetToPlayPositions || []).sort();
                awayTeam.thpp.inPlay = game.awayScore.inPlay || 0;
                awayTeam.thpp.alreadyPlayed =
                    game.awayScore.alreadyPlayed === undefined
                        ? 9 - (game.awayScore.yetToPlay || 0)
                        : 0;
                const homeTeam = teams.find(team => team.id === game.home.id);
                homeTeam.thpp.week16 = game.homeScore.score.value || 0;
                homeTeam.thpp.yetToPlay = game.homeScore.yetToPlay || 0;
                homeTeam.thpp.yetToPlayPositions = (game.homeScore.yetToPlayPositions || []).sort();
                homeTeam.thpp.inPlay = game.homeScore.inPlay || 0;
                homeTeam.thpp.alreadyPlayed =
                    game.homeScore.alreadyPlayed === undefined
                        ? 9 - (game.homeScore.yetToPlay || 0)
                        : 0;

                // Cache opponent status.
                awayTeam.thpp.opponent16 = game.homeScore.score.value || 0;
                homeTeam.thpp.opponent16 = game.awayScore.score.value || 0;
            })
        );

        // Generate team summaries.
        console.log(`${Date.now()} Generating team summaries.`);
        const summaries = teams
            .sort((a, b) => b.thpp.total - a.thpp.total)
            .map((team, index) => {
                // Generate emoji lineup
                let yetToPlay = [];
                yetToPlay.length = team.thpp.yetToPlay || 0;
                yetToPlay.fill('🔲');
                yetToPlay = yetToPlay.join('');
                let inPlay = [];
                inPlay.length = team.thpp.inPlay || 0;
                inPlay.fill('🏈');
                inPlay = inPlay.join('');
                let alreadyPlayed = [];
                alreadyPlayed.length = team.thpp.alreadyPlayed || 0;
                alreadyPlayed.fill('✅');
                alreadyPlayed = alreadyPlayed.join('');
                const lineup = `${yetToPlay}${inPlay}${alreadyPlayed}`;

                // Return summary.
                return `${index + 1}|${team.name}|${
                    team.league
                }|${lineup}|**${team.thpp.total.toFixed(2)}**|${(2 * team.thpp.average).toFixed(
                    2
                )}|${team.thpp.week15.toFixed(2)}|${team.thpp.week16.toFixed(
                    2
                )}|${team.thpp.opponent16.toFixed(2)}`;
            });

        // Update reddit post.
        console.log(`${Date.now()} Updating reddit.`);
        const r = new snoowrap({
            userAgent: 'script',
            clientId: REDDIT_CLIENT_ID,
            clientSecret: REDDIT_CLIENT_SECRET,
            username: REDDIT_USERNAME,
            password: REDDIT_PASSWORD,
        });
        await r.getSubmission(REDDIT_THING_ID).edit(`
## The Horn Playoffs **LIVE!**

This is an unofficial live computation of **The Horn Playoff Points**:  
\`[.5 * (Regular Season Points Avg)] + (Week 15 Score) + (Week 16 Score) = Total Horn Playoff Points\`

_Updated every five minutes._  
_Last updated: ${new Date().toTimeString()}_

Rank|Team|League|Lineup|THPP|Average|Week 15|Week 16|Opponent
:--|:--|:--|:-:|:-:|:-:|:-:|:-:|:-:
${summaries.join('\r\n')}
        `);
        console.log(`${Date.now()} Finished.`);
    }

    // Run cron job.
    new CronJob('*/1 * * * *', updateRedditPost, null, true, null, null, true);
})();
