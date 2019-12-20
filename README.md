# NarFFL Analytics

This is a collection of historical NarFFL data, both a summary of its format/leagues/rules over time, as well as raw data (where available).

## A Brief History

-   **2009**: NarFFL created by StruggleBunny  
    12 teams.
-   **2010**: First expansion.  
    48 teams.
-   **2011**: Premier premieres in its current structure.  
    192 teams (144 Premier, 48 Alt).  
    Gridiron challenge used for Horn.
-   **2012**: NarFFL grows a little too fast, lots of abandoned alt teams.
    1488 teams (144 Premier, 1344 Alt).  
    Gridiron challenge used for Horn and promotion.
-   **2013**: Modern Premier/Majors/Minors structure, and shrinking for stability.  
    1088 teams (144 Premier, 288 Major, 576 Minor).  
    Gridiron challenge used for Horn.  
    Modern promotion/relegation introduced.  
    Alt teams from prior season placed in Majors/Minors based on 2012 finish (needs verification).
-   **2014-2019**: Modern Horn, added Farm.  
    1392 teams (144 Premier, 288 Major, 576 Minor, 384 Farm)  
    No changes since, aside from how the Farm lottery works.

## Data Availability

-   **2009** ❌ (NFL.com)
-   **2010** ✅ (MyFantasyLeague)
-   **2011** ❌ (ESPN)
-   **2012** ✅ Premier, ❌ Alt (Fleaflicker)
-   **2013** ✅ (Fleaflicker)
-   **2014** ✅ (Fleaflicker)
-   **2015** ✅ (Fleaflicker)
-   **2016** ✅ (Fleaflicker)
-   **2017** ✅ (Fleaflicker)
-   **2018** ✅ (Fleaflicker)
-   **2019** ✅ (Fleaflicker, in progress)

## ELO Ratings

We're using this data to compute ELO ratings, which can give us some insight into historical performance both of individual owners, as well as leagues and divisions.

-   2012 was the first modern-ish season, the second year of a 144-team league with relegations.
-   2012 alt leagues aren't accessible anymore, but the league had grown so much that the data may have been lower quality anyways.
-   2013 was the first season where we have full data available.
-   2013 majors/minors were constructed using 2012 alt league finishes, so we can use that to estimate starting ELO.

Given that, we'll make the following assumptions:

-   ELO ratings start in 2012 when possible, otherwise 2013.
-   An owner's first two seasons are considered a provisional rating (with `K = 32`), which will fluctuate more wildly. A single season may be a good enough sample size, but everyone has bad seasons once in a while so this helps account for that.
-   Experienced owners are given an official rating (with `K = 20`), which fluctuates less.
-   Base ratings -- primarily these are based on the size of tiers, averaging out to about 1500.
    -   Premier: 1900
    -   Major: 1750
    -   Minor: 1500
    -   Farm: 1200
-   Teams start with a rating according to the base rating for their tier.
-   For each game played
    -   The team will get a `1.0` game credit for a win, `0.5` for a tie, and `0.0` for a loss.
    -   Additionally, the team will get another 1/10 game credit for all-play against the other 10 teams -- `0.1` per all-play win, `0.05` per all-play tie.
    -   By factoring both of these, we're compensating a bit for luck, while still ensuring that actual wins matter. This also helps out some in cases where a team is in an especially strong division, as they can still gain rating via all-play if they're legitimately strong.
-   Each offseason there is a reset, where each team gets `2/3` of their difference from the base rating.
    -   This takes effect after promotion/relegation, so a promoted Farm team would get pulled towards the Minor base rating.
    -   `(OLD_RATING - BASE_RATING) * 2 / 3 + BASE_RATING = NEW_RATING`
    -   Example: A major team finishes at `1850`, but doesn't get promoted. `(1850 - 1750) * 2/3 + 1750 = 1817 = NEW_RATING`

### ELO Ideas

-   Bonuses for championships (but that may happen naturally with the offseason reset).
    -   This may make more sense for Premier.
