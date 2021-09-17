// ==UserScript==
// @name         Ganbarometer
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Add Pace and Difficulty gauges to the Wanikani Dashboard
// @author       Rex Walters (Rrwrex AKA rw [at] pobox.com)
// @copyright    2021 Rex Robert Walters
// @license      MIT-0 https://opensource.org/licenses/MIT-0
// @include      /^https://(www|preview).wanikani.com/(dashboard)?$/
// @require      https://greasyfork.org/scripts/410909-wanikani-review-cache/code/Wanikani:%20Review%20Cache.js
// @grant        none
// ==/UserScript==
//
// Note: This script uses the cache from Kumirei's Review Cache:
// https://community.wanikani.com/t/userscript-review-cache/46162
//
// Since this script only needs a few days of reviews, I could have eliminated
// a dependency and allowed the script to load much faster by using
// wkof.Apiv2.fetch_endpoint() instead of get_reviews(), but I figured many
// users of this script will also install Kumire's wonderful Heatmap script
// (https://community.wanikani.com/t/userscript-wanikani-heatmap/34947).
// So I thought it made sense to share the same cache.
//
// I may revisit this decision in a future version, though.

(function (wkof, review_cache) {
  "use strict";

  /*
   * * * * User Modifiable Constants * * *
   */

  // Number of hours to summarize reviews over
  const interval = 72;

  // Number of minutes since prior review for a subsequent review
  // to be considered in the same session
  const sessionIntervalMax = 10;

  // Change to 'true' if you want to enable debugging
  const debug = true;

  /*
   * -------------------- Do Not Edit Below This Line -----------------------------
   */

  // This script identifiers for caches, etc.
  const script_id = "ganbarometer";
  const script_name = "Ganbarometer";

  // Ensure WKOF is installed
  if (!wkof) {
    let response = confirm(
      `${script_name} requires WaniKani Open Framework.
Click "OK" to be forwarded to installation instructions.`
    );
    if (response) {
      window.location.href =
        "https://community.wanikani.com/t/instructions-installing-wanikani-open-framework/28549";
      return;
    }
  }

  // Wait until modules are ready then initiate script
  wkof.include("ItemData, Apiv2");
  wkof.ready("ItemData, Apiv2").then(render);

  // The metrics we want to retrieve and display
  const metrics = {
    reviewed: 0, // TBD: total number of items reviewed over interval
    sessions: [], // TBD: array of Session objects
    apprentice: 0, // TBD: total number of items currently in Apprentice (stages 1-4)
    newKanji: 0, // TBD: total number of radicals & kanji in stages 1 or 2
    minutes: function () {
      // total number of minutes spent reviewing over interval
      let min = 0;
      for (let sess of this.sessions) {
        min += sess.minutes();
      }
      return min;
    },
    misses: function () {
      // number of review items answered incorrectly over interval
      let s = 0;
      for (let sess of this.sessions) {
        s += sess.misses;
      }
      return s;
    },
    load: function () {
      // reviews-per-day averaged over the interval
      return Math.round((this.reviewed * 24) / interval);
    },
    speed: function () {
      // seconds-per-review averaged over the sessions
      return Math.round((60 * this.minutes()) / this.reviewed);
    },
    difficulty: function () {
      // return a value from 0 to 100, with 50 representing "normal"
      // Normal = 100 items in Apprentice bucket (stages 1-4)
      // but kanji in stages 1 and 2 are more difficult
      // so weight them heavily (10 such items make it 50% more difficult)
      let weighting = 1 + this.newKanji * 0.05;
      let raw = Math.round((this.apprentice / 100) * 50 * weighting);
      return raw > 100 ? 100 : raw;
    },
  };

  /*
   * ********* MAIN function to calculate and display metrics ********
   */
  async function render(itemData, apiv2) {
    // Get all reviews, then filter out all but the most recent
    // get_reviews() returns an Array of "reviews" (each review is an Array)
    // each individual array contains:
    // [creationDate, subjectID, startingSRS, incorrectMeaning, incorrectReading]
    let allReviews = await review_cache.get_reviews();
    let newReviews = filterRecent(allReviews, interval);
    // Save our first metric
    metrics.reviewed = newReviews.length;
    // Calculate and save our second set of metrics
    // findSessions() returns an Array of Session objects
    metrics.sessions = findSessions(newReviews);

    // Finally, retrieve and save the apprentice and newKanji metrics
    let config = {
      wk_items: {
        filters: {
          srs: "appr1, appr2, appr3, appr4",
        },
      },
    };
    let items = await wkof.ItemData.get_items(config);
    metrics.apprentice = items.length;
    config = {
      wk_items: {
        filters: {
          srs: "appr1, appr2",
          item_type: "kan",
        },
      },
    };
    items = await wkof.ItemData.get_items(config);
    metrics.newKanji = items.length;

    // Optionally log what we've extracted
    if (debug) {
      console.log(
        `${metrics.reviewed} reviews in ${interval} hours (${
          allReviews.length
        } total reviews)
${metrics.misses()} total misses
${metrics.minutes()} total minutes
${metrics.sessions.length} sessions:`
      );
      metrics.sessions.forEach((s) => {
        console.log(
          `     - Start: ${s.startTime}
       End: ${s.endTime}
       Misses: ${s.misses}
       Reviews: ${s.len}
       Review minutes: ${s.minutes()}`
        );
      });
      console.log(
        `${metrics.apprentice} apprentice ${metrics.newKanji} newKanji`
      );
      console.log(`${metrics.load()} reviews per day`);
      console.log(`${metrics.speed()} seconds per review on average`);
      console.log(`Difficulty: ${metrics.difficulty()} on a scale of 0 to 100`);
      // debugger;
    }
  }

  // Function to return a filtered array of reviews
  // older than the specified number of hours
  function filterRecent(reviews, hours) {
    return reviews.filter(
      // a[0] = creationDate
      (a) => a[0] > Date.now() - hours * 60 * 60 * 1000
    );
  }

  // A Session object holds an index into an array of reviews, plus a length
  // Define a Session object
  function Session(firstIndex, length, startTime, endTime, misses) {
    this.firstIndex = firstIndex; // index of first review in this session
    this.len = length; // number of reviews in this session
    this.startTime = startTime; // start time of first review (Date object)
    this.endTime = endTime; // start(!!) time of final review (Date object)
    this.misses = misses; // "miss" means one or more incorrect answers (reading or meaning)
    this.minutes = function () {
      // number of minutes spent reviewing in this session
      return Math.round((this.endTime - this.startTime) / (1000 * 60));
    };
  }

  // Find sequences of reviews no more than sessionIntervalMax apart
  function findSessions(reviews) {
    // Start with an empty array of sessions
    let sessions = [];
    // Get the time of the first review
    let firstTime = reviews.length > 0 ? new Date(reviews[0][0]) : new Date(0);
    // Initialize what will become sessions[0]
    let curSession = new Session(
      0, // firstIndex - start with reviews[0]
      0, // length (currently unknown, initialize to zero)
      firstTime, // startTime is time of first review
      firstTime, // endTime (currently unknown, initialize to startTime)
      0 // misses (currently unknown, initialize to zero)
    );
    // Now iterate through reviews to find sessions
    // note that reviews[0] is guaranteed to be within the current session!
    reviews.forEach((review) => {
      if (
        withinSession(
          curSession.endTime, // prevTime
          review[0], // newTime
          sessionIntervalMax // maxMinutes
        )
      ) {
        // Still within a session, so increment the length
        curSession.len += 1;
        // "miss" means one or more incorrect meaning or reading answers
        curSession.misses += review[3] + review[4] > 0 ? 1 : 0;
        // Update endTime the the time of this review
        curSession.endTime = new Date(review[0]);
      } else {
        // Finished prior session and starting a new one
        sessions.push(curSession);
        // And create a new curSession of length 1 for this review
        let newIndex = curSession.firstIndex + curSession.len;
        let newDate = new Date(review[0]);
        let curMisses = review[3] + review[4] > 0 ? 1 : 0;
        curSession = new Session(newIndex, 1, newDate, newDate, curMisses);
      }
    });
    // Don't forget the last session when we fall out of the loop
    sessions.push(curSession);
    return sessions;
  }

  // Determine if newTime is within maxMinutes of prevTime
  function withinSession(prevTime, newTime, maxMinutes) {
    let timeDifference = newTime - prevTime;
    return timeDifference <= maxMinutes * 1000 * 60 * 60;
  }
})(window.wkof, window.review_cache);
