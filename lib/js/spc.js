//
// Copyright (c) 2013 by Michael Beasley.  All Rights Reserved.
//
// SPC (statistical process control) is a tool used in many
// manufacturing settings to monitor critical metrics surrounding
// a process and to identify data points that are part of the normal
// variance associated with that metric, or more importnatly, those
// that are signficantly abnormal.  The goal is to prevent tampering
// with processes that are simply exhibiting expected fluxuations
// with respect to certian metrics, while simultaneously being
// certain to identify the root causes of those fluxuations that are
// truly unexpected.
//
// While SPC is a standard practice in many industries, there are
// very few tools available to create these charts with relative
// with relative ease.  It is my goal to present such a tool with
// spc.js.


//Requirements:
// underscore.js
// underscore.math.js
// d3.js
// moment.js

function spc(selector, data, options) {

    var defaults = {
        // What is the name of the key measure?
        measureName: null,

        // Does the data describe a count or a measure
        bCount: false,

        // Does the count data describe a defect count or a defective?
        // NOTE: This is only used if bCount is true
        bDefect: false,

        // Is the area of opportunity for the count constant?
        // NOTE: This is only used if bCount is true
        bConstant: false,

        // What is the title to display over the chart? Null or empty
        // string will hide the title block
        title: null,

        // Duration to use for transitions
        duration: 0,

        // Log the charting process in the console
        verbose: true,

        // Set the units to be displays as a string.  .
        units: 'hrs',

        // Override the detection of slowly evolving data
        bSlow: false,

        // Override the chart type
        chart: null,

        // Override the group sizes
        groupSize: null,

        // Specify the line interpolation to use in the charts.  Default is
        // "monotone" which gives slightly rounded edges, but maintains
        // fidelity to your data.  Use "basis" for low fidelity, highly rounded
        // edges or "linear" for perfect fidelity lines with no rounding.
        interpolation: 'cardinal',

        // Override the central line value (mean) or control limits to use for the xbar & r chart
        xCL: null,
        xUCL: null,
        xLCL: null,
        rCL: null,
        rUCL: null,
        rLCL: null
    };


    // Merge specified options with defaults
    if (options) {
        options = _.defaults(options, defaults);
    } else {
        options = defaults;
    }


    // Local variable for storing local closure items
    var local = {},
        pub = {};

    // Main chart object
    pub.chart = function() {
        // Prepare data
        data = parseData(data);

        // If the chart type is specified, no need to go through
        // the following decision tree
        // NOTE: Groupsize MUST be specified if this is the case
        if (options.chart) {
            if (!options.groupSize) {
                throw "Group size must be set!";
            }

            local.groupSize = options.groupSize;

            if (local[options.chart]) {
                local[options.chart]();
                return;
            } else {
                throw "Specified chart type does not exist.";
            }
        }


        // Measures are treated differently than counts
        if (options.bCount) {
            local.verbose('Using attribute data (counts).');
            // Specify whether we're counting defectives (i.e. on-time
            // or late) or defects (i.e. errors)
            if (options.bDefect) {
                local.verbose('Counting defects.');

                // Specify whether the area of opportunity for each
                // sample is constant or not
                if (options.bConstant) {
                    local.verbose('Area of opportunity is constant.');

                    // Create c chart
                    local.cChart();

                } else {
                    local.verbose('Area of opportunity is not constant.');

                    // Create u chart
                    local.uChart();
                }

            } else {
                local.verbose('Counting defectives.');

                // Specify whether the area of opportunity for each
                // sample is constant or not
                if (options.bConstant) {
                    local.verbose('Area of opportunity is constant.');

                    // Create np chart
                    local.npChart();

                } else {
                    local.verbose('Area of opportunity is not constant.');

                    // Create p chart
                    local.pChart();
                }
            }

        } else {
            local.verbose('Using measure data.');

            // Whether or not the data is bell-shaped
            // will determine how we organize or data.
            if (bBellShaped(local.values)) {
                local.verbose('Data is bell-shaped.');

                // Slowly evolving data means that individual &
                // moving range charts should be used.  Otherwise
                // standard x-bar and R charts should be used.
                if (bSlowlyEvolving(local.values, [2,3])) {
                    local.verbose('Data is slowly evolving.');

                    // Create individual and moving range chart
                    local.indivMovingRangeChart();

                } else {
                    local.verbose('Data is not slowly evolving.');

                    // Create standard x-Bar & R charts
                    local.xBarRChart();
                }

            } else {
                local.verbose('Data is not bell-shaped.');

                // Again, slowly evolving data means that moving
                // x-bar and moving R charts should be used.  Otherwise,
                // standard x-bar and R charts should be used.
                if (bSlowlyEvolving(local.values, [3,5])) {
                    local.verbose('Data is slowly evolving.');

                    // Create standard x-Bar & R charts
                    local.groupSize = 4;
                    local.movingXBarRChart();

                } else {
                    local.verbose('Data is not slowly evolving.');

                    // Create standard x-Bar & R charts
                    local.xBarRChart();
                }
            }
        }
    };


    /*
     *  PRIVATE FUNCTIONS
     */


    // Prepare the data and parse out the data characteristics
    function parseData(data) {
        local.verbose('Parsing data...');

        local.keys = d3.keys(data);
        local.values = d3.values(data);

        local.verbose(' - values: ' + JSON.stringify(local.values));

        local.data = {
            means: {
                values: [],
                n: 0,
                min: 0,
                max: 0,
                chart: 'xBar',
                cl: 0,
                ul: [],
                ll: [],
                exceptions: []
            },
            ranges: {
                values: [],
                n: 0,
                min: 0,
                max: 0,
                chart: 'R',
                cl: 0,
                ul: [],
                ll: [],
                exceptions: []
            },
            n: local.values.length
        };

        local.verbose(' - n: ' + local.data.n);

        return data;
    }


    // Determine if the data is bellshaped (normal)
    function bBellShaped(array) {
        // Using a p-value of 0.05 for null hypothesis,
        // we are going to use the Shapiro-Wilk test for
        // normality.

        // Be sure to use underscore's clone method here. Otherwise,
        // the Shapiro Wilk test will sort the actual data.
        var clone = _.clone(array);

        // This is the threshhold for the test associated
        // with the 0.05 p-value.
        var threshhold = 0.7879999876022339;

        local.verbose('Testing for normality...');

        var W = ShapiroWilkW(clone),
            passString = (W >= threshhold) ? 'passes.' : 'fails.';

        local.verbose(' - W (normal): ' + W + ', ' + passString);

        return W >= threshhold;
    }


    // Determine if the data is slowly evolving
    function bSlowlyEvolving(values, range) {
        local.verbose('Testing for slowly evolving data...');

        if (options.bSlow) {
            return true;
        }

        // The range argument is the range of subgroup sizes to attempt
        // to test for before concluding that the data is slowly evolving.
        for (var i = d3.min(range); i <= d3.max(range); i++) {

            // If there aren't even enough data points to split into
            // subgroups of size i and still yield > than 20 subgroups,
            // then the data is slowly evolving
            if (local.data.n < i * 20) {
                local.verbose(' - Not enough data points.  Data is slowly evolving.');
                return true;
            }

            // Organize the data into subgroups of size i and compute the
            // mean of each subgroup.  Applying the Central Limit Theorum,
            // if the distribution of subgroup mean values is normal, then
            // we can say that the subgroup size is sufficient.  But if
            // not, then we should increase the subgroup size and try again.

            var subgroups = subgroup(values, i),
                means = subgroupMeans(subgroups);

            if (bBellShaped(means)) {
                local.verbose(' - Normally distributed means at subgroup size ' + i + '. Data is not slowly evolving.');
                local.groupSize = i;
                return false;
            }
        }

        // Given the central limit theorum, if the function still hasn't returned,
        // then the data will be classified as slowly evolving within the limits
        // of the range of subgroups specified.
        local.verbose(' - Data is slowly evolving.');
        return true;
    }


    // Organize data into non-overlapping subgroups of specified size
    function subgroup(array, size) {
        local.verbose('Adjusting data into subgroups of size ' + size + '...');

        var retArr = [].concat.apply([],
                array.map(function(elem,i) {
                    return i%size ? [] : [array.slice(i,i+size)];
                })
            );

        return retArr;
    }


    // Organize data into overlapping moving subgroups of specified size
    function movingSubgroup(array, size) {
        local.verbose('Adjusting data into moving subgroups of size ' + size + '...');

        var retArr = [];

        for (var i = 0; i < array.length - (size - 1); i++){
            retArr.push(array.slice(i, i+size));
        }

        return retArr;
    }


    // Return array of means from an array of subgroups
    function subgroupMeans(array) {
        local.verbose('Calculating means from subgroups...');

        var retArr = [];

        for (var i = 0; i < array.length; i++) {
            retArr.push(_.mean(array[i]));
        }

        return retArr;
    }


    // Return array of ranges from an array of subgroups
    function subgroupRanges(array) {
        local.verbose('Calculating ranges from subgroups...');

        var retArr = [];

        for (var i = 0; i < array.length; i++) {
            retArr.push(d3.max(array[i]) - d3.min(array[i]));
        }

        return retArr;
    }


    // Organize data into defective groups of specified size
    // and use standard unit groupings if specified
    function defectiveGroup(size, bStandardUnit) {
        local.verbose('Adjusting defects into subgroups with ' + size + 'defects in each...');

    }

    function chartFactors(factor, n) {

        var factors = {
            A2: {
                1: 2.66, 2: 1.88, 3: 1.02, 4: 0.73, 5: 0.58, 7: 0.42, 10: 0.31
            },
            D2: {
                2: 1.10, 3: 1.69, 4: 2.06, 5: 2.33, 7: 2.70, 10: 3.08
            },
            D3: {
                2: 0, 3: 0, 4: 0, 5: 0, 7: 0.08, 10: 0.22
            },
            D4: {
                2: 3.27, 3: 2.58, 4: 2.28, 5: 2.12, 7: 1.92, 10: 1.78
            }
        };

        return factors[factor][n];
    }


    /*
     *  CHARTS
     */

    // Generate a standard xBar and R chart
    local.xBarRChart = function() {
        local.verbose('Generating xBar & R chart...');

        var xCL, xUL, xLL, rCL, rUL, rLL,
            groups = subgroup(local.values, local.groupSize),
            means = subgroupMeans(groups),
            ranges = subgroupRanges(groups);

        local.data.means.values = means;
        local.data.means.chart = 'xBar';
        local.data.means.n = local.data.means.values.length;

        local.data.ranges.values = ranges;
        local.data.ranges.chart = 'R';
        local.data.ranges.n = local.data.ranges.values.length;


        // Establish the central lines and the control limit values
        // for the means and ranges charts.
        // NOTE: control limits can be overridden by `options.[control]`
        xCL = local.data.means.cl = options.xCL || _.sum(means) / groups.length;
        rCL = local.data.ranges.cl = options.rCL || _.sum(ranges) / groups.length;

        xUL = local.data.means.ul = options.xUL || xCL + chartFactors('A2', local.groupSize) * rCL;
        xLL = local.data.means.ll = options.xLL || xCL - chartFactors('A2', local.groupSize) * rCL;
        xUL = local.data.means.ul = makeArrayOf(xUL, local.data.means.n);
        xLL = local.data.means.ll = makeArrayOf(xLL, local.data.means.n);

        rUL = local.data.ranges.ul = options.rUL || chartFactors('D4', local.groupSize) * rCL;
        rLL = local.data.ranges.ll = options.rLL || chartFactors('D3', local.groupSize) * rCL;
        rUL = local.data.ranges.ul = makeArrayOf(rUL, local.data.ranges.n);
        rLL = local.data.ranges.ll = makeArrayOf(rLL, local.data.ranges.n);


        // Specify the min and max of each set, considering the control limits as well
        local.data.means.max = d3.max([d3.max(local.data.means.values), d3.max(local.data.means.ul)]);
        local.data.means.min = d3.min([d3.min(local.data.means.values), d3.min(local.data.means.ll)]);
        local.data.ranges.max = d3.max([d3.max(local.data.ranges.values), d3.max(local.data.ranges.ul)]);
        local.data.ranges.min = d3.min([d3.min(local.data.ranges.values), d3.min(local.data.ranges.ll)]);

        local.data.means.exceptions = variationTest(means, xCL, xUL, xLL);
        local.data.ranges.exceptions = variationTest(ranges, rCL, rUL, rLL);

        chartSetup();

        drawLines();
    };

    // Generate a moving average and moving range chart
    local.movingXBarRChart = function() {
        local.verbose('Generating moving avg and moving range chart...');

        var xCL, xUL, xLL, rCL, rUL, rLL,
            groups = movingSubgroup(local.values, local.groupSize),
            means = subgroupMeans(groups),
            ranges = subgroupRanges(groups);

        local.data.means.values = means;
        local.data.means.chart = 'mX';
        local.data.means.n = local.data.means.values.length;

        local.data.ranges.values = ranges;
        local.data.ranges.chart = 'mR';
        local.data.ranges.n = local.data.ranges.values.length;


        // Establish the central lines and the control limit values
        // for the means and ranges charts.
        // NOTE: control limits can be overridden by `options.[control]`
        xCL = local.data.means.cl = options.xCL || _.sum(means) / groups.length;
        rCL = local.data.ranges.cl = options.rCL || _.sum(ranges) / groups.length;

        xUL = local.data.means.ul = options.xUL || xCL + chartFactors('A2', local.groupSize) * rCL;
        xLL = local.data.means.ll = options.xLL || xCL - chartFactors('A2', local.groupSize) * rCL;
        xUL = local.data.means.ul = makeArrayOf(xUL, local.data.means.n);
        xLL = local.data.means.ll = makeArrayOf(xLL, local.data.means.n);

        rUL = local.data.ranges.ul = options.rUL || chartFactors('D4', local.groupSize) * rCL;
        rLL = local.data.ranges.ll = options.rLL || chartFactors('D3', local.groupSize) * rCL;
        rUL = local.data.ranges.ul = makeArrayOf(rUL, local.data.ranges.n);
        rLL = local.data.ranges.ll = makeArrayOf(rLL, local.data.ranges.n);


        // Specify the min and max of each set, considering the control limits as well
        local.data.means.max = d3.max([d3.max(local.data.means.values), d3.max(local.data.means.ul)]);
        local.data.means.min = d3.min([d3.min(local.data.means.values), d3.min(local.data.means.ll)]);
        local.data.ranges.max = d3.max([d3.max(local.data.ranges.values), d3.max(local.data.ranges.ul)]);
        local.data.ranges.min = d3.min([d3.min(local.data.ranges.values), d3.min(local.data.ranges.ll)]);

        local.data.means.exceptions = variationTest(means, xCL, xUL, xLL);
        local.data.ranges.exceptions = variationTest(ranges, rCL, rUL, rLL);

        chartSetup();

        drawLines();
    };

    // Generate an individuals and moving range chart
    local.indivMovingRangeChart = function() {
        local.verbose('Generating individuals and moving range chart...');

    };

    // Generate an np chart
    local.npChart = function() {
        local.verbose('Generating np chart...');

    };

    // Generate p chart
    local.pChart = function() {
        local.verbose('Generating p chart...');

    };

    // Generate c chart
    local.cChart = function() {
        local.verbose('Generating c chart...');

    };

    // Generate u chart
    local.uChart = function() {
        local.verbose('Generating u chart...');

    };

    // Draw chart lines
    function drawLines() {

        local.meansGenerator = d3.svg.line()
            .interpolate(options.interpolation)
            .x(function (d,i) {
                return local.mean.x(i);
            })
            .y(function (d) {
                return local.mean.y(d);
            });

        local.meansControlGenerator = d3.svg.line()
            .interpolate('step-after')
            .x(function (d,i) {
                return local.mean.x(i);
            })
            .y(function (d) {
                return local.mean.y(d);
            });

        local.rangesGenerator = d3.svg.line()
            .interpolate(options.interpolation)
            .x(function(d,i) {
                return local.range.x(i);
            })
            .y(function(d) {
                return local.range.y(d);
            });

        local.rangesControlGenerator = d3.svg.line()
            .interpolate('step-after')
            .x(function (d,i) {
                return local.range.x(i);
            })
            .y(function (d) {
                return local.range.y(d);
            });

        if (local.means) {
            local.means
                .transition().duration(options.duration)
                .attr("d", function (d,i) {
                    return local.meansGenerator(local.data.means.values);
                });

            local.meansCL
                .transition().duration(options.duration)
                .attr('d', function(d,i) {
                    return local.meansGenerator(makeArrayOf(local.data.means.cl, local.data.means.n));
                });

            local.meansUL
                .transition().duration(options.duration)
                .attr('d', function(d,i) {
                    return local.meansControlGenerator(local.data.means.ul);
                });

            local.meansLL
                .transition().duration(options.duration)
                .attr('d', function(d,i) {
                    return local.meansControlGenerator(local.data.means.ll);
                });

            local.meanExceptions
                .transition()
                .duration(options.duration)
                .attr('cx', function(d) {
                    return local.mean.x(d[0]);
                })
                .attr('cy', function(d) {
                    return local.mean.y(local.data.means.values[d[0]]);
                });
        } else {
            local.means = local.mean
                .append("svg:path")
                .attr("d", function (d,i) {
                    return local.meansGenerator(local.data.means.values);
                })
                .attr("class", "line");

            local.meansCL = local.mean
                .append('svg:path')
                .attr('d', function(d,i) {
                    return local.meansGenerator(makeArrayOf(local.data.means.cl, local.data.means.n));
                })
                .attr('class', 'line cl');

            local.meansUL = local.mean
                .append('svg:path')
                .attr('d', function(d,i) {
                    return local.meansControlGenerator(local.data.means.ul);
                })
                .attr('class', 'line ul');

            local.meansLL = local.mean
                .append('svg:path')
                .attr('d', function(d,i) {
                    return local.meansControlGenerator(local.data.means.ll);
                })
                .attr('class', 'line ll');

            local.meanExceptions = local.mean.selectAll('exception')
                .data(local.data.means.exceptions);

            local.meanExceptions.enter()
                .append('circle')
                .attr('cx', function(d) {
                    return local.mean.x(d[0]);
                })
                .attr('cy', function(d) {
                    return local.mean.y(local.data.means.values[d[0]]);
                })
                .attr('r', 2)
                .attr('class', 'exception')
                .append('svg:title')
                .text(function(d) {
                    return d[1];
                });
        }

        if (local.ranges) {
            local.ranges
                .transition().duration(options.duration)
                .attr('d', function(d,i) {
                    return local.rangesGenerator(local.data.ranges.values);
                });

            local.rangesCL
                .transition().duration(options.duration)
                .attr('d', function(d,i) {
                    return local.rangesGenerator(makeArrayOf(local.data.ranges.cl, local.data.ranges.n));
                });

            local.rangesUL
                .transition().duration(options.duration)
                .attr('d', function(d,i) {
                    return local.rangesControlGenerator(local.data.ranges.ul);
                });

            local.rangesLL
                .transition().duration(options.duration)
                .attr('d', function(d,i) {
                    return local.rangesControlGenerator(local.data.ranges.ll);
                });

            local.rangeExceptions
                .transition()
                .duration(options.duration)
                .attr('cx', function(d) {
                    return local.range.x(d[0]);
                })
                .attr('cy', function(d) {
                    return local.range.y(local.data.ranges.values[d[0]]);
                });
        } else {
            local.ranges = local.range
                .append("svg:path")
                .attr('d', function(d,i) {
                    return local.rangesGenerator(local.data.ranges.values);
                })
                .attr("class", "line");

            local.rangesCL = local.range
                .append('svg:path')
                .attr('d', function(d,i) {
                    return local.rangesGenerator(makeArrayOf(local.data.ranges.cl, local.data.ranges.n));
                })
                .attr('class', 'line cl');

            local.rangesUL = local.range
                .append('svg:path')
                .attr('d', function(d,i) {
                    return local.rangesControlGenerator(local.data.ranges.ul);
                })
                .attr('class', 'line ul');

            local.rangesLL = local.range
                .append('svg:path')
                .attr('d', function(d,i) {
                    return local.rangesControlGenerator(local.data.ranges.ll);
                })
                .attr('class', 'line ll');

            local.rangeExceptions = local.range.selectAll('exception')
                .data(local.data.ranges.exceptions);

            local.rangeExceptions.enter()
                .append('circle')
                .attr('cx', function(d) {
                    return local.range.x(d[0]);
                })
                .attr('cy', function(d) {
                    return local.range.y(local.data.ranges.values[d[0]]);
                })
                .attr('r', 2)
                .attr('class', 'exception')
                .append('svg:title')
                .text(function(d) {
                    return d[1];
                });
        }

    }

    // Small utility function for populating arrays
    function makeArrayOf(value, length) {
        var arr = [], i = length;
        while (i--) {
            arr[i] = value;
        }
        return arr;
    }


    // Tests for non-random, special cause variation.
    // tests to data array to test, the control limits
    // and the test(s) to run.  If no tests are specified, all
    // tests will be run.
    function variationTest(array, CL, UCL, LCL, testArray) {
        local.verbose('Testing data for special cause variation...');

        var tests = {
            // All tests return an exception array of **indeces** in the
            // the array that do not pass the test, not the values themselves

            // Find one or more points outside of the control limits
            1: function() {
                var exceptions = [];

                for (var i = 0; i < array.length; i++) {
                    if (array[i] > UCL[i] || array[i] < LCL[i]) {
                        exceptions.push([i, 'Point outside of control limits.']);
                    }
                }

                if (exceptions.length > 0) {
                    local.verbose(' - ' + exceptions.length + ' points outside of control limits...');

                    return exceptions;
                }

                // If there are no exceptions, then the test passed (returns false)
                return false;
            },

            // Find runs of significant length (>= 8 points above or below)
            // the central line
            2: function() {
                var runLength = 0,
                    bPositive,
                    exceptions = [],
                    newRun = true;

                for (var i = 0; i < array.length; i++) {
                    if (i===0) {
                        bPositive = (array[i] >= CL);
                    } else {
                        if ((array[i] >= CL) === bPositive) {
                            runLength++;
                        } else {
                            runLength = 0;
                            newRun = true;
                            bPositive = (array[i] >= CL);
                        }

                        if (runLength >= 8 && newRun) {
                            exceptions.push([i, 'Run of significant length.']);
                            newRun = false;
                        }
                    }
                }

                if (exceptions.length > 0) {
                    local.verbose(' - ' + exceptions.length + ' run(s) of significant length...');

                    return exceptions;
                }

                // If there are no exceptions, then the test passed (returns false)
                return false;

            },

            // Find significant number of runs (crossing the central
            // line).  The first suspect here is ALWAYS tampering.
            3: function() {

                // NOTE: this is a really dumb way of doing this and ultimately,
                // this should be an actual statistical equation that dictates
                // what a significant number of runs is for a given sample size.
                // But for now, this will be determined using regression analysis
                // of Swed & Eisenharts tables for testing randomness of grouping.
                var exceptions = [],
                    runs = 0,
                    n = array.length,
                    highLow,
                    high = function(n) {
                        return 0.6209 * n + 3.0801;
                    }, low = function(n) {
                        return 0.3791 * n + 2.5679;
                    };

                for (var i = 1; i < array.length; i++) {
                    // Check to see if the current iteration and the previous
                    // are oppositely signed

                    if ((array[i-1] - CL < 0) !== (array[i] - CL < 0)) {
                        runs++;
                    }
                }

                // Add one more for the tail run
                runs++;

                if (runs >= high(n) || runs <= low(n)) {
                    highLow = (runs >= high(n)) ? 'high' : 'low';
                    exceptions.push([n-1, 'Significantly ' + highLow + ' number of runs found.']);
                }

                if (exceptions.length > 0) {
                    local.verbose(' - Significantly ' + highLow + ' number of runs (' + runs + ')...');

                    return exceptions;
                }

                // If there are no exceptions, then the test passed (returns false)
                return false;
            },

            // Identify significant trends: 6 points or more in a row of
            // increasing or decreasing values
            4: function() {
                var exceptions = [],
                    decreasingRun = 0,
                    increasingRun = 0;

                for (var i = 1; i < array.length; i++) {
                    if (array[i] > array[i - 1]) {
                        increasingRun++;
                        decreasingRun = 0;
                    } else if (array[i] < array[i - 1]) {
                        decreasingRun++;
                        increasingRun = 0;
                    } // } else if (array[i] === array[i - 1]) {
                    //     decreasingRun = 0;
                    //     increasingRun = 0;
                    // }

                    if (increasingRun >= 6 || decreasingRun >= 6) {
                        exceptions.push([i, 'Significant trend identified.']);
                        increasingRun = decreasingRun = 0;
                    }
                }

                if (exceptions.length > 0) {
                    local.verbose(' - ' + exceptions.length + ' trends found...');

                    return exceptions;
                }

                // If there are no exceptions, then the test passed (returns false)
                return false;
            }
        };

        // Run all tests if test(s) are not specified
        testArray = testArray || [1,2,3,4];

        results = [];

        for (var i = 0; i < testArray.length; i++) {
            var failed = tests[testArray[i]]();
            if (!failed) {
                local.verbose(' - Test ' + testArray[i] + ' passed.');
            } else {
                local.verbose(' - Test ' + testArray[i] + ' failed.');
                results = results.concat(failed);
            }
        }

        results = _.uniq(results).sort();

        return results;
    }

    // Construct measure charts.  By specifying the boolean
    // values for individuals or moving changes the chart from
    // "Individual & Moving Range Charts", "Moving x-Bar & Moving
    // R Charts", or a standard "x-Bar * R Charts".
    function measureChart(bIndividual, bMoving) {
        local.verbose('Generating measure chart...');

        // setup the chart area
        chartSetup();

    }


    // Construct count charts.  The type of the chart can either
    // be "np", "p", "c" or "u".  But these are automatically
    // determined by the type of data and measure used.
    function countChart(type) {
        local.verbose('Generating ' + type + ' chart (counts)...');

        // setup the chart area
        chartSetup();


    }


    // Construct the chart SVG area
    function chartSetup() {
        local.verbose('Setting up chart area...');

        // select the container
        local.container = d3.select(selector);


        // get the width and height of the selector
        local.width = parseInt(local.container.style('width'), 0);
        local.height = parseInt(local.container.style('height'), 0);


        // generate the svg object
        local.svg = local.container
            .append('svg')
            .attr('width', local.width + 'px')
            .attr('height', local.height + 'px');

        // setup the grouping for average and range chart areas
        local.mean = local.svg.append('svg:g')
            .attr('class', 'average');

        local.range = local.svg.append('svg:g')
            .attr('class', 'range');

        // establish scales
        local.mean.y  = d3.scale.linear()
            .range([local.height*(5/8) - 25, 5])
            .domain([local.data.means.min, local.data.means.max])
            .nice();

        local.mean.x = d3.scale.linear()
            .range([46, local.width])
            .domain([0, local.data.means.n - 1])
            .nice();

        local.range.y  = d3.scale.linear()
            .range([local.height - 5, local.height*(5/8) - 5])
            .domain([local.data.ranges.min, local.data.ranges.max])
            .nice();

        local.range.x = d3.scale.linear()
            .range([46, local.width])
            .domain([0, local.data.ranges.n - 1])
            .nice();


        // add axes (only if width and length are large enough)
        if (local.height > 200) {
            local.mean.yAxis = d3.svg.axis()
                .scale(local.mean.y)
                .ticks(2)
                .tickSubdivide(1)
                .orient('left');

            local.mean.yAxisSVG = local.mean.append('svg:g')
                .attr('class', 'yMeanAxis axis')
                .attr('transform', 'translate(45,0)')
                .call(local.mean.yAxis);

            local.range.yAxis = d3.svg.axis()
                .scale(local.range.y)
                .ticks(2)
                .tickSubdivide(0)
                .orient('left');

            local.range.yAxisSVG = local.range.append('svg:g')
                .attr('class', 'yRangeAxis axis')
                .attr('transform', 'translate(45,0)')
                .call(local.range.yAxis);
        }

        if (local.height > 100) {
            // axis labels for Averages and Ranges
            var units = (options.units) ? ' (' + options.units + ')' : '';

            local.mean.label = local.mean.append('text')
                .attr('transform', 'rotate(-90,0,0)')
                .attr('y', 10)
                .attr('x', -1 * local.mean.y((local.data.means.max - local.data.means.min) / 2 + local.data.means.min))
                .attr('class', 'mean-label')
                .attr('text-anchor', 'middle')
                .text(local.data.means.chart + units);

            local.range.label = local.range.append('text')
                .attr('transform', 'rotate(-90,0,0)')
                .attr('y', 10)
                .attr('x', -1 * local.range.y((local.data.ranges.max - local.data.ranges.min) / 2 + local.data.ranges.min))
                .attr('class', 'range-label')
                .attr('text-anchor', 'middle')
                .text(local.data.ranges.chart + units);
        }

        // add clip path for chart


        // add title if specified


    }

    /*
     *  EXPOSED FUNCTIONS
     */

    // Redraw the chart
    pub.chart.redraw = function(silent) {
        if (!silent) {
            local.verbose('Redrawing the chart...');
        }

        // select the container
        local.container = d3.select(selector);

        // get the width and height of the selector
        local.width = parseInt(local.container.style('width'), 0);
        local.height = parseInt(local.container.style('height'), 0);

        // generate or update the svg object
        local.svg
            .transition()
            .duration(options.duration)
            .attr('width', local.width + 'px')
            .attr('height', local.height + 'px');


        // establish scales to be used for charts
        local.mean.y
            .range([local.height*(5/8) - 25, 5])
            .domain([local.data.means.min, local.data.means.max])
            .nice();

        local.mean.x
            .range([46, local.width - 5])
            .domain([0, local.data.means.n - 1])
            .nice();

        local.range.y
            .range([local.height - 5, local.height*(5/8) - 5])
            .domain([local.data.ranges.min, local.data.ranges.max])
            .nice();

        local.range.x
            .range([46, local.width - 5])
            .domain([0, local.data.ranges.n - 1])
            .nice();


        // add axes (only if width and length are large enough)
        if (local.height > 200) {
            if (!local.mean.yAxis || !local.range.yAxis) {
                local.mean.yAxis = d3.svg.axis()
                    .scale(local.mean.y)
                    .ticks(2)
                    .tickSubdivide(1)
                    .orient('left');

                local.mean.yAxisSVG = local.mean.append('svg:g')
                    .attr('class', 'yMeanAxis axis')
                    .attr('transform', 'translate(45,0)')
                    .call(local.mean.yAxis);

                local.range.yAxis = d3.svg.axis()
                    .scale(local.range.y)
                    .ticks(2)
                    .tickSubdivide(0)
                    .orient('left');

                local.range.yAxisSVG = local.range.append('svg:g')
                    .attr('class', 'yRangeAxis axis')
                    .attr('transform', 'translate(45,0)')
                    .call(local.range.yAxis);
            } else {
                local.mean.yAxis
                    .scale(local.mean.y);

                local.mean.yAxisSVG
                    .transition()
                    .duration(options.duration)
                    .attr('transform', 'translate(45,0)')
                    .call(local.mean.yAxis);

                local.range.yAxis
                    .scale(local.range.y);

                local.range.yAxisSVG
                    .transition()
                    .duration(options.duration)
                    .attr('transform', 'translate(45,0)')
                    .call(local.range.yAxis);
            }
        } else {
            if (local.mean.yAxisSVG && local.range.yAxisSVG) {
                local.mean.yAxisSVG.remove();
                local.mean.yAxis = undefined;

                local.range.yAxisSVG.remove();
                local.range.yAxis = undefined;
            }
        }

        if (local.height > 100) {
            if (!local.mean.label || !local.range.label) {
                // axis labels for Averages and Ranges
                var units = (options.units) ? ' (' + options.units + ')' : '';

                local.mean.label = local.mean.append('text')
                    .attr('transform', 'rotate(-90,0,0)')
                    .attr('y', 10)
                    .attr('x', -1 * local.mean.y((local.data.means.max - local.data.means.min) / 2 + local.data.means.min))
                    .attr('class', 'mean-label')
                    .attr('text-anchor', 'middle')
                    .text(local.data.means.chart + units);

                local.range.label = local.range.append('text')
                    .attr('transform', 'rotate(-90,0,0)')
                    .attr('y', 10)
                    .attr('x', -1 * local.range.y((local.data.ranges.max - local.data.ranges.min) / 2 + local.data.ranges.min))
                    .attr('class', 'range-label')
                    .attr('text-anchor', 'middle')
                    .text(local.data.ranges.chart + units);
            } else {
                // axis labels for Averages and Ranges
                local.mean.label
                    .transition()
                    .duration(options.duration)
                    .attr('x', -1 * local.mean.y((local.data.means.max - local.data.means.min) / 2 + local.data.means.min));

                local.range.label
                    .transition()
                    .duration(options.duration)
                    .attr('x', -1 * local.range.y((local.data.ranges.max - local.data.ranges.min) / 2 + local.data.ranges.min));
            }
        } else {
            if (local.mean.label && local.range.label) {
                local.mean.label.remove();
                local.mean.label = undefined;

                local.range.label.remove();
                local.range.label = undefined;
            }
        }

        drawLines();
    };

    // Output the histogram of the data. If a selector is
    // specified, then a graphical histogram will be displayed
    // within the selector.  If no selector is specified, then
    // the histogram will be output into the console.
    pub.histogram = function(selector) {
        local.verbose('Generating histogram of raw data...');

    };

    // a basic getter and setter method for options. The
    // optional redraw parameter, with a default of true,
    // specifies whether the option change will trigger a
    // redraw.
    pub.option = function(key, value, redraw) {
        local.verbose('Changing ' + key + ' to ' + value + '...');

        if (arguments.length === 0) {
            throw "No arguments supplied. Specify an option.";
        } else if (arguments.length === 1) {
            return options[key];
        } else {
            options[key] = value;

            if (redraw) {
                pub.chart.redraw();
            }

            return true;
        }
    };

    pub.data = function(data) {
        if (arguments.length === 0) {
            return local.data;
        } else {
            local.verbose('Modifying data...');

            parseData(data);
            pub.chart.redraw();
        }
    };

    /*
     *  Lastly, here are some util functions for stats and such
     */

    local.verbose = function(msg) {
        if (options.verbose) {
            console.log(msg);
        }
    };


    /*
     *  Ported from http://svn.r-project.org/R/trunk/src/nmath/qnorm.c
     *
     *  Mathlib : A C Library of Special Functions
     *  Copyright (C) 1998       Ross Ihaka
     *  Copyright (C) 2000--2005 The R Core Team
     *  based on AS 111 (C) 1977 Royal Statistical Society
     *  and   on AS 241 (C) 1988 Royal Statistical Society
     *
     *  This program is free software; you can redistribute it and/or modify
     *  it under the terms of the GNU General Public License as published by
     *  the Free Software Foundation; either version 2 of the License, or
     *  (at your option) any later version.
     *
     *  This program is distributed in the hope that it will be useful,
     *  but WITHOUT ANY WARRANTY; without even the implied warranty of
     *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
     *  GNU General Public License for more details.
     *
     *  You should have received a copy of the GNU General Public License
     *  along with this program; if not, a copy is available at
     *  http://www.r-project.org/Licenses/
     */

    // The inverse of cdf.
    function normalQuantile(p, mu, sigma)
    {
        var p, q, r, val;
        if (sigma < 0)
            return -1;
        if (sigma == 0)
            return mu;

        q = p - 0.5;

        if (0.075 <= p && p <= 0.925) {
            r = 0.180625 - q * q;
            val = q * (((((((r * 2509.0809287301226727 + 33430.575583588128105) * r + 67265.770927008700853) * r
                + 45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r + 133.14166789178437745) * r
                + 3.387132872796366608) / (((((((r * 5226.495278852854561 + 28729.085735721942674) * r + 39307.89580009271061) * r
                + 21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r + 42.313330701600911252) * r + 1);
        }
        else { /* closer than 0.075 from {0,1} boundary */
            /* r = min(p, 1-p) < 0.075 */
            if (q > 0)
                r = 1 - p;
            else
                r = p;/* = R_DT_Iv(p) ^=  p */

            r = Math.sqrt(-Math.log(r)); /* r = sqrt(-log(r))  <==>  min(p, 1-p) = exp( - r^2 ) */

            if (r <= 5.) { /* <==> min(p,1-p) >= exp(-25) ~= 1.3888e-11 */
                r += -1.6;
                val = (((((((r * 7.7454501427834140764e-4 + 0.0227238449892691845833) * r + .24178072517745061177) * r
                    + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r
                    + 4.6303378461565452959) * r + 1.42343711074968357734) / (((((((r * 1.05075007164441684324e-9 + 5.475938084995344946e-4) * r
                    + .0151986665636164571966) * r + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r
                    + 2.05319162663775882187) * r + 1);
            }
            else { /* very close to  0 or 1 */
                r += -5.;
                val = (((((((r * 2.01033439929228813265e-7 + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r
                    + 0.026532189526576123093) * r + .29656057182850489123) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r
                    + 6.6579046435011037772) / (((((((r * 2.04426310338993978564e-15 + 1.4215117583164458887e-7)* r
                    + 1.8463183175100546818e-5) * r + 7.868691311456132591e-4) * r + .0148753612908506148525) * r
                    + .13692988092273580531) * r + .59983220655588793769) * r + 1.);
            }

            if (q < 0.0)
                val = -val;
            /* return (q >= 0.)? r : -r ;*/
        }
        return mu + sigma * val;
    }

    /*
     *  Ported from http://svn.r-project.org/R/trunk/src/library/stats/src/swilk.c
     *
     *  R : A Computer Language for Statistical Data Analysis
     *  Copyright (C) 2000-12   The R Core Team.
     *
     *  Based on Applied Statistics algorithms AS181, R94
     *    (C) Royal Statistical Society 1982, 1995
     *
     *  This program is free software; you can redistribute it and/or modify
     *  it under the terms of the GNU General Public License as published by
     *  the Free Software Foundation; either version 2 of the License, or
     *  (at your option) any later version.
     *
     *  This program is distributed in the hope that it will be useful,
     *  but WITHOUT ANY WARRANTY; without even the implied warranty of
     *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
     *  GNU General Public License for more details.
     *
     *  You should have received a copy of the GNU General Public License
     *  along with this program; if not, a copy is available at
     *  http://www.r-project.org/Licenses/
     */

    function sign(x) {
        if (x == 0)
            return 0;
        return x > 0 ? 1 : -1;
    }

    function ShapiroWilkW(x)
    {
        function poly(cc, nord, x)
        {
            /* Algorithm AS 181.2   Appl. Statist.  (1982) Vol. 31, No. 2
            Calculates the algebraic polynomial of order nord-1 with array of coefficients cc.
            Zero order coefficient is cc(1) = cc[0] */
            var p;
            var ret_val;

            ret_val = cc[0];
            if (nord > 1) {
                p = x * cc[nord-1];
                for (j = nord - 2; j > 0; j--)
                    p = (p + cc[j]) * x;
                ret_val += p;
            }
            return ret_val;
        }
        x = x.sort(function (a, b) { return a - b; });
        var n = x.length;
        if (n < 3)
            return undefined;
        var nn2 = Math.floor(n / 2);
        var a = new Array(Math.floor(nn2) + 1); /* 1-based */

    /*  ALGORITHM AS R94 APPL. STATIST. (1995) vol.44, no.4, 547-551.

        Calculates the Shapiro-Wilk W test and its significance level
    */
        var small = 1e-19;

        /* polynomial coefficients */
        var g = [ -2.273, 0.459 ];
        var c1 = [ 0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056 ];
        var c2 = [ 0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633 ];
        var c3 = [ 0.544, -0.39978, 0.025054, -6.714e-4 ];
        var c4 = [ 1.3822, -0.77857, 0.062767, -0.0020322 ];
        var c5 = [ -1.5861, -0.31082, -0.083751, 0.0038915 ];
        var c6 = [ -0.4803, -0.082676, 0.0030302 ];

        /* Local variables */
        var i, j, i1;

        var ssassx, summ2, ssumm2, gamma, range;
        var a1, a2, an, m, s, sa, xi, sx, xx, y, w1;
        var fac, asa, an25, ssa, sax, rsn, ssx, xsx;

        var pw = 1;
        an = n;

        if (n == 3)
            a[1] = 0.70710678;/* = sqrt(1/2) */
        else {
            an25 = an + 0.25;
            summ2 = 0.0;
            for (i = 1; i <= nn2; i++) {
                a[i] = normalQuantile((i - 0.375) / an25, 0, 1); // p(X <= x),
                var r__1 = a[i];
                summ2 += r__1 * r__1;
            }
            summ2 *= 2;
            ssumm2 = Math.sqrt(summ2);
            rsn = 1 / Math.sqrt(an);
            a1 = poly(c1, 6, rsn) - a[1] / ssumm2;

            /* Normalize a[] */
            if (n > 5) {
                i1 = 3;
                a2 = -a[2] / ssumm2 + poly(c2, 6, rsn);
                fac = Math.sqrt((summ2 - 2 * (a[1] * a[1]) - 2 * (a[2] * a[2])) / (1 - 2 * (a1 * a1) - 2 * (a2 * a2)));
                a[2] = a2;
            } else {
                i1 = 2;
                fac = Math.sqrt((summ2 - 2 * (a[1] * a[1])) / ( 1  - 2 * (a1 * a1)));
            }
            a[1] = a1;
            for (i = i1; i <= nn2; i++)
                a[i] /= - fac;
        }

    /*  Check for zero range */

        range = x[n - 1] - x[0];
        if (range < small) {
            console.log('range is too small!')
            return undefined;
        }


    /*  Check for correct sort order on range - scaled X */

        xx = x[0] / range;
        sx = xx;
        sa = -a[1];
        for (i = 1, j = n - 1; i < n; j--) {
            xi = x[i] / range;
            if (xx - xi > small) {
                console.log("xx - xi is too big.", xx - xi);
                return undefined;
            }
            sx += xi;
            i++;
            if (i != j)
                sa += sign(i - j) * a[Math.min(i, j)];
            xx = xi;
        }
        if (n > 5000) {
            console.log("n is too big!")
            return undefined;
        }


    /*  Calculate W statistic as squared correlation
        between data and coefficients */

        sa /= n;
        sx /= n;
        ssa = ssx = sax = 0.;
        for (i = 0, j = n - 1; i < n; i++, j--) {
            if (i != j)
                asa = sign(i - j) * a[1 + Math.min(i, j)] - sa;
            else
                asa = -sa;
            xsx = x[i] / range - sx;
            ssa += asa * asa;
            ssx += xsx * xsx;
            sax += asa * xsx;
        }

    /*  W1 equals (1-W) calculated to avoid excessive rounding error
        for W very near 1 (a potential problem in very large samples) */

        ssassx = Math.sqrt(ssa * ssx);
        w1 = (ssassx - sax) * (ssassx + sax) / (ssa * ssx);
        var w = 1 - w1;

    /*  Calculate significance level for W */

        if (n == 3) {/* exact P value : */
            var pi6 = 1.90985931710274; /* = 6/pi */
            var stqr = 1.04719755119660; /* = asin(sqrt(3/4)) */
            pw = pi6 * (Math.asin(Math.sqrt(w)) - stqr);
            if (pw < 0.)
                pw = 0;
            return w;
        }
        y = Math.log(w1);
        xx = Math.log(an);
        if (n <= 11) {
            gamma = poly(g, 2, an);
            if (y >= gamma) {
                pw = 1e-99; /* an "obvious" value, was 'small' which was 1e-19f */
                return w;
            }
            y = -Math.log(gamma - y);
            m = poly(c3, 4, an);
            s = Math.exp(poly(c4, 4, an));
        } else { /* n >= 12 */
            m = poly(c5, 4, xx);
            s = Math.exp(poly(c6, 3, xx));
        }

        // Oops, we don't have pnorm
        // pw = pnorm(y, m, s, 0/* upper tail */, 0);

        return w;
    }



    return pub;
}

