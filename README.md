This is v1.0 of the [GanbarOmeter user script](https://greasyfork.org/en/scripts/432632-ganbarometer).

This script adds three **gauges** to your dashboard. After all, what's a _dashboard_ without gauges?

![Screen Shot 2021-09-20 at 5.47.16 PM|690x491](upload://hBD854wgdeLlZ2FvN4scBy8DrCQ.jpeg)

[The gold bar at the top is my [Burns Progress](https://community.wanikani.com/t/userscript-burn-progress/53412) user script which you may also find useful.]

These gauges **help you decide whether to speed up or slow down doing lessons.** If the values displayed are mostly in the middle of the ranges, you should continue at roughly the same pace. If any start moving toward or even peg at the extreme right of the gauge, you might consider slowing down. Lower values mean you might want to speed up.

- **Difficulty** — A heuristic representing how difficult your upcoming reviews will likely be. It's presented on a scale of 0 to 50%, where the middle of the scale (50%) represents "normal difficulty." Values at the higher end of the scale indicate you'll likely find it hard to answer most review items correctly. Values higher than 80% will turn the gauge yellow. Higher than 90% will turn it red.

- **Load** — This displays how **much** work you've been doing on average each day. It's measured in reviews per day. Note that it doesn't matter how many review sessions you perform each day, the script averages across all sessions for the past several days.

- **Speed** — This displays how **quickly** you answer each review question on average. It's measured in seconds per review.

All values are based on the current state of your Apprentice bucket and the past few days of reviews. By default, it averages your review statistics using the past three days (72 hours) worth of reviews. The difficulty depends on the number of Apprentice items, with additional weighting for a large number of kanji in Stages 1 or 2 or a high percentage of incorrect answers in previous reviews.

The settings menu provides control over all of the "magic numbers" used in these heuristics, but I'm hopeful that the defaults will be reasonable for most people.

**NOTE**: If you change and save your settings, they won't take immediate effect. With the current version, you'll need to refresh your browser window. I will try to address this in a future version of the script.

[details="Installation"]

1. [General script installation instructions](https://community.wanikani.com/t/visual-guide-on-how-to-install-a-userscript/12136)

2. [Install the Wanikani Open Framework](https://community.wanikani.com/t/installing-wanikani-open-framework/28549)

3. Install the [GanbarOmeter](https://greasyfork.org/en/scripts/432632-ganbarometer) from Greasy Spoon.

[/details]

[details="Background"]

In normal use, the [WK SRS](https://knowledge.wanikani.com/wanikani/srs-stages/) behaves as a very complex system. Its behavior depends on several things, primarily:

1. Whether or not you finish all the reviews that are due on a given day.

2. How many review items you answer incorrectly in a given session.

3. The make-up of your "in progress" items: those radicals, kanji, and vocabulary items that have been reviewed at least once, but haven't yet been burned.

   - How many items in earlier (Apprentice) stages. The more of these, the more reviews will be due each day.

   - How many kanji are in the first two stages. Most people find kanji more difficult than radicals and vocabulary, especially when they've just been introduced and you don't have a lot of reviews for the item under your belt. Radicals don't have readings, and vocabulary often provides additional context.

4. The number of lessons you perform each day. Finishing a lesson moves that item into the first stage of the SRS.

Items 1 and 2 are mostly out of your control: You really must try to do all your reviews every day if at all possible, or things can get out of hand quickly. And the percentage of incorrect answers depends on how well your memory is being trained.

Item 3 can only be indirectly controlled.

That leaves item 4: **how quickly you do lessons has the greatest effect on how difficult you'll find your daily reviews!**

The GanbarOmeter distills information from your recent reviews and your Apprentice items, aiming to provide useful feedback on when to speed up or slow down doing reviews.

[/details]

[details="Difficulty: displayed values and explanation"]

This is the most difficult gauge to understand, but it uses some heuristics to tell you how "difficult" your upcoming reviews are likely to be, based on the stages of items under active review and the percentage of reviews you've been answering incorrectly recently.

With the default settings and no weighting factors applied, this gauge will display the needle at the halfway point if you currently have 100 items in Apprentice stages.

You may want to adjust the `Desired number of apprentice items` setting to something other than 100, depending on your comfort level. This is a personal preference thing.

Additional weighting is applied for any kanji (not radicals or vocabulary) in stages 1 or 2.

Further weighting is applied if answered more than 20% of your daily average number of reviews (as reported under Load) incorrectly.

You can adjust the weightings with: `New kanji weighting factor` (default: 0.05), `Typical percentage of items missed during reviews` (default: 20), and `Extra misses weighting` (default: 0.03).

A `New kanji weighting factor` of 0.05 means that 10 kanji items in stages 1 or 2 will be 50% "heavier" than other items in the Apprentice bucket. In other words, each kanji is 5% heavier (0.05).

Similarly, an `Extra misses weighting` of 0.03 increases the overall weight of your Apprentice items. With the defaults, if you had exactly 100 items in Apprentice stages, with no kanji items in stage 1 or stage 2, each "miss" (incorrectly answered item) would make the Apprentice queue 3% heavier. If you had missed 24 items, for example, instead of displaying a Difficulty of 50%, it would display 56%:

```
Display value = (100 apprentice items * 0.03 * 4 extra misses) / 200 items at max scale
              = 112 / 200
              = 0.56
              = 56%
```

[/details]

[details="Load: displayed values and explanation"]
This is the easiest of the gauges to understand. It simply shows the average number of reviews you are performing per day (24 hours). By default, it averages the past three days (72 hours) worth of results.

The settings variable `Running average hours` allows you to change the default if you wish. It should probably be a multiple of 24 hours.
[/details]

[details="Speed: displayed values and explanation"]
This is also an easy gauge to understand. It shows how long on average it takes you to answer a single review item, in units of seconds per review.

Unfortunately, the Wanikani API doesn't provide this information directly. For valid technical reasons, Wanikani only stores the **start** time of an individual review.

So the GanbarOmeter first gathers (by default) the past 72 hours of reviews and breaks them into "sessions" based on the following heuristic:

Consecutive reviews that are started within `Session interval` minutes apart (10 minutes by default) are considered to be in the same session. Any interval longer than this starts a new session.

The total time spent on each session is the difference between the start time of the first review, and the **start** time of the last review within the session. Unfortunately, the timestamp of the final response isn't available, so session minutes are slightly undercounted (this undercounting effect is biggest for very short sessions of only a few reviews).

The Speed value displayed is the sum of the minutes from each session, divided by the total number of items reviewed by all sessions.
[/details]

#### Caveats

This is a fairly complex script involving several heuristics. I've only been using it for a few days, so it's possible that further tuning will be necessary.

There is also a distinct possibility of a bug or three lurking somewhere. I'm not an experienced Javascript programmer, so the script is unlikely to be terribly performant, reliable, or idiomatic.

While this is a somewhat experimental idea, I'm looking forward to hearing feedback and improving this going forward.

Please let me know in this thread if you do uncover any issues.

#### TODO

- Re-render when settings saved
- Display pareto instead of speed gauge
- Speed-up loading (cache and update reviews asynchronously?)
