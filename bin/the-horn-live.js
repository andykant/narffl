import {readFileSync} from 'fs';
import fetch from 'node-fetch';
import cron from 'cron';
import snoowrap from 'snoowrap';
import dateTZ from 'date-fns-tz';
import dotenv from 'dotenv-defaults';
import yargs from 'yargs';
dotenv.config();

// Grab the processing action.
const action = yargs.parse()._[0];

const {CronJob} = cron;
const {zonedTimeToUtc, utcToZonedTime, format} = dateTZ;
const {
    SEASON,
    WEEK,
    TIMEZONE,
    REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET,
    REDDIT_REFRESH_TOKEN,
    REDDIT_SUBREDDIT,
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
    thpp.total = Number((thpp.average + thpp.week16 + thpp.week17).toFixed(2));
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

    // Retrieve Horn teams.
    const teams = [];
    await Promise.all(
        leagues.map(async ({id, name}) => {
            const scoreboard = await fetchScoreboard({id, week: WEEK});
            const games = scoreboard.games.filter(game =>
                WEEK === '17' ? game.isChampionshipGame : game.isPlayoffs
            );

            games.forEach(game => {
                // Append metadata.
                game.away.league = name;
                game.away.teamUrl = `https://www.fleaflicker.com/nfl/leagues/${id}/teams/${game.away.id}`;
                game.home.league = name;
                game.home.teamUrl = `https://www.fleaflicker.com/nfl/leagues/${id}/teams/${game.home.id}`;
                game.away.leagueUrl = game.home.leagueUrl = `https://www.fleaflicker.com/nfl/leagues/${id}`;
                game.away.scoreUrl = game.home.scoreUrl = `https://www.fleaflicker.com/nfl/leagues/${id}/scores/${game.id}`;

                teams.push(game.away);
                teams.push(game.home);
            });
        })
    );

    // Populate default THPP.
    teams.forEach(team => {
        team.thpp = {
            average: Number(((team.pointsFor.value / 13) * 0.5).toFixed(2)),
            week16: 0,
            week17: 0,
        };
        updateTHPP(team.thpp);
    });

    // Retrieve regular season average and week 15 scores.
    if (WEEK === '17') {
        await Promise.all(
            leagues.map(async ({id}) => {
                // Grab the games with Horn teams.
                const scoreboard = await fetchScoreboard({id, week: 15});
                const games = scoreboard.games.filter(game =>
                    teams.find(team => team.id === game.away.id || team.id === game.home.id)
                );

                // Cache average and week 15 scores.
                games.forEach(game => {
                    const side = teams.find(team => team.id === game.home.id) ? 'home' : 'away';
                    const team = teams.find(team => team.id === game[side].id);

                    // Compute THPP values.
                    team.thpp.week16 = game[`${side}Score`].score.value || 0;
                    updateTHPP(team.thpp);
                });
            })
        );
    }

    // Create reddit updater.
    async function updateRedditPost() {
        // Retrieve requested week (16 or 17) statuses.
        console.log(`${Date.now()} Retrieving week ${WEEK} stats.`);
        await Promise.all(
            leagues.map(async ({id}) => {
                // Grab the games with Horn teams.
                const scoreboard = await fetchScoreboard({id, week: WEEK});
                const games = scoreboard.games.filter(game =>
                    WEEK === '17' ? game.isChampionshipGame : game.isPlayoffs
                );

                games.forEach(game => {
                    // Cache week status.
                    const awayTeam = teams.find(team => team.id === game.away.id);
                    if (!awayTeam) console.log(`${game.id} ${game.away.id}`);
                    awayTeam.thpp[`week${WEEK}`] = game.awayScore.score.value || 0;
                    awayTeam.thpp.yetToPlay = game.awayScore.yetToPlay || 0;
                    awayTeam.thpp.yetToPlayPositions = (
                        game.awayScore.yetToPlayPositions || []
                    ).sort();
                    awayTeam.thpp.inPlay = game.awayScore.inPlay || 0;
                    awayTeam.thpp.alreadyPlayed =
                        game.awayScore.alreadyPlayed === undefined
                            ? 9 - (game.awayScore.yetToPlay || 0) - (game.awayScore.inPlay || 0)
                            : game.awayScore.alreadyPlayed;
                    awayTeam.thpp.final = awayTeam.thpp.alreadyPlayed === 9;
                    const homeTeam = teams.find(team => team.id === game.home.id);
                    homeTeam.thpp[`week${WEEK}`] = game.homeScore.score.value || 0;
                    homeTeam.thpp.yetToPlay = game.homeScore.yetToPlay || 0;
                    homeTeam.thpp.yetToPlayPositions = (
                        game.homeScore.yetToPlayPositions || []
                    ).sort();
                    homeTeam.thpp.inPlay = game.homeScore.inPlay || 0;
                    homeTeam.thpp.alreadyPlayed =
                        game.homeScore.alreadyPlayed === undefined
                            ? 9 - (game.homeScore.yetToPlay || 0) - (game.homeScore.inPlay || 0)
                            : game.homeScore.alreadyPlayed;
                    homeTeam.thpp.final = homeTeam.thpp.alreadyPlayed === 9;

                    // Cache opponent status.
                    awayTeam.thpp[`opponent${WEEK}`] = game.homeScore.score.value || 0;
                    awayTeam.thpp.opponentFinal = homeTeam.thpp.final;
                    homeTeam.thpp[`opponent${WEEK}`] = game.awayScore.score.value || 0;
                    homeTeam.thpp.opponentFinal = awayTeam.thpp.final;

                    // Cache whether a team has lost.
                    // Normally we're verifying that both teams have final scores.
                    // However, as long as the target team is final and losing by at least 10,
                    // we can safely call that a loss.
                    awayTeam.thpp.lost =
                        awayTeam.thpp.final &&
                        awayTeam.thpp[`week${WEEK}`] - homeTeam.thpp[`week${WEEK}`] <
                            (homeTeam.thpp.final ? 0 : -10);
                    homeTeam.thpp.lost =
                        homeTeam.thpp.final &&
                        homeTeam.thpp[`week${WEEK}`] - awayTeam.thpp[`week${WEEK}`] <
                            (awayTeam.thpp.final ? 0 : -10);

                    // Re-compute THPP.
                    updateTHPP(awayTeam.thpp);
                    updateTHPP(homeTeam.thpp);
                });
            })
        );

        // Generate team summaries.
        console.log(`${Date.now()} Generating team summaries.`);
        const summaries = teams
            // Sort by points.
            .sort((a, b) => b.thpp.total - a.thpp.total)
            // Then sort by whether they lost already.
            .sort((a, b) => a.thpp.lost - b.thpp.lost)
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
                const lineup = `${alreadyPlayed}${inPlay}${yetToPlay}`;

                // Return summary.
                const week16 =
                    WEEK === '16'
                        ? `[${team.thpp.week16.toFixed(2)}${team.thpp.final ? '✅' : ''}](${
                              team.scoreUrl
                          })`
                        : team.thpp.week16.toFixed(2);
                const week17 =
                    WEEK === '17'
                        ? `[${team.thpp.week17.toFixed(2)}${team.thpp.final ? '✅' : ''}](${
                              team.scoreUrl
                          })`
                        : team.thpp.week17.toFixed(2);
                return `${index + 1}|**${team.thpp.total.toFixed(2)}**|[${
                    team.thpp.lost ? `~~${team.name}~~` : team.name
                }](${team.teamUrl})|[${team.league}](${team.leagueUrl})|${lineup}|${(
                    2 * team.thpp.average
                ).toFixed(2)}|${week16}|${week17}|${team.thpp[`opponent${WEEK}`].toFixed(2)}${
                    team.thpp.opponentFinal ? '✅' : ''
                }`;
            });

        // Compute last updated time.
        const utcNow = zonedTimeToUtc(new Date(), Intl.DateTimeFormat.timeZone);
        const now = format(utcToZonedTime(utcNow, TIMEZONE), 'yyyy-MM-dd h:mmaaaaa (z)', {
            timeZone: TIMEZONE,
        });

        // Generate markdown.
        const markdown = `
This is an official live computation of **The Horn Playoff Points**:  
\`[.5 * (Regular Season Points Avg)] + (Week 16 Score) + (Week 17 Score) = Total Horn Playoff Points\`

🔲 = player yet to play  
🏈 = player currently playing  
✅ = player finished playing OR team final score

_Updated every five minutes during games._  
_Last updated: ${now}_

Rank|THPP|Team|League|Lineup|Average|Week16|Week17|Opponent
:--|:--|:--|:-:|:-:|:-:|:-:|:-:|:-:
${summaries.join('\r\n')}
        `;

        // Create reddit API instance.
        const r = new snoowrap({
            userAgent: 'script',
            clientId: REDDIT_CLIENT_ID,
            clientSecret: REDDIT_CLIENT_SECRET,
            refreshToken: REDDIT_REFRESH_TOKEN,
        });

        switch (action) {
            // Create a dummy post.
            case 'create':
                console.log(`${Date.now()} Creating reddit post.`);
                await r
                    .submitSelfpost({
                        subredditName: REDDIT_SUBREDDIT,
                        title: `The Hunt for the Horn LIVE (${SEASON}) - Week ${WEEK}`,
                        text: markdown,
                    })
                    .then(console.log);
                process.exit(0);
                break;
            // Update reddit post.
            case 'update':
                console.log(`${Date.now()} Updating reddit post.`);
                await r
                    .getSubmission(REDDIT_THING_ID)
                    .edit(markdown)
                    .then(console.log);
                console.log(`${Date.now()} Finished.`);
                break;
            // Dry run, just show the markdown result.
            case 'dry-run':
            default:
                console.log(markdown);
                process.exit(0);
                break;
        }
    }

    // Run cron job.
    new CronJob('*/5 * * * *', updateRedditPost, null, true, null, null, true);
})();
