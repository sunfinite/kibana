/* global _ */

/*
 * Complex scripted Logstash dashboard
 * This script generates a dashboard object that Kibana can load. It also takes a number of user
 * supplied URL parameters, none are required:
 *
 * index :: Which index to search? If this is specified, interval is set to 'none'
 * pattern :: Does nothing if index is specified. Set a timestamped index pattern. Default: [logstash-]YYYY.MM.DD
 * interval :: Sets the index interval (eg: day,week,month,year), Default: day
 *
 * split :: The character to split the queries on Default: ','
 * query :: By default, a comma separated list of queries to run. Default: *
 *
 * from :: Search this amount of time back, eg 15m, 1h, 2d. Default: 15m
 * timefield :: The field containing the time to filter on, Default: @timestamp
 *
 * fields :: comma separated list of fields to show in the table
 * sort :: comma separated field to sort on, and direction, eg sort=@timestamp,desc
 *
 * Notes @skatkuri: Fork logstash.js
 *
 */



var dashboard, queries, _d_timespan;

var ARGS;

_d_timespan = '1d';

dashboard = {
  rows : [],
  services : {}
};

dashboard.title = 'Kibana';
dashboard.style = 'light';

if(!_.isUndefined(ARGS.index)) {
  dashboard.index = {
    default: ARGS.index,
    interval: 'none'
  };
} else {
  // Don't fail to default
  dashboard.failover = false;
  dashboard.index = {
    default: ARGS.index||'ADD_A_TIME_FILTER',
    pattern: ARGS.pattern||'[logstash-]YYYY.MM.DD',
    interval: ARGS.interval||'day'
  };
}



// In this dashboard we let users pass queries as comma separated list to the query parameter.
// Or they can specify a split character using the split aparameter
// If query is defined, split it into a list of query objects
// NOTE: ids must be integers, hence the parseInt()s
if(!_.isUndefined(ARGS.query)) {
  queries = _.object(_.map(ARGS.query.split(ARGS.split||','), function(v,k) {
    return [k,{
      query: v,
      id: parseInt(k,10),
      alias: v
    }];
  }));
} else {
  // No queries passed? Initialize a single query to match everything
  queries = {
    0: {
      query: '*',
      id: 0,
    }
  };
}

// Now populate the query service with our objects
dashboard.services.query = {
  list : queries,
  ids : _.map(_.keys(queries),function(v){return parseInt(v,10);})
};

// Lets also add a default time filter, the value of which can be specified by the user
dashboard.services.filter = {
  list: {
    0: {
      from: "now-"+(ARGS.from||_d_timespan),
      to: "now",
      field: ARGS.timefield||"timestamp",
      type: "time",
      active: false,
      id: 0,
    }
  },
  ids: [0]
};


dashboard.rows = [
    {
      "title": "Graphs",
      "height": "150px",
      "editable": true,
      "collapse": false,
      "collapsable": true,
      "panels": [
        {
          "error": false,
          "span": 4,
          "editable": true,
          "type": "terms",
          "loadingEditor": false,
          "field": "objstat",
          "exclude": [],
          "missing": true,
          "other": true,
          "size": 10,
          "order": "count",
          "style": {
            "font-size": "10pt"
          },
          "donut": false,
          "tilt": false,
          "labels": true,
          "arrangement": "horizontal",
          "chart": "bar",
          "counter_pos": "above",
          "spyable": true,
          "queries": {
            "mode": "all",
            "ids": [
              0
            ]
          },
          "tmode": "terms",
          "tstat": "total",
          "valuefield": "",
          "title": "Objstat: Case Sensitive."
        }
      ],
    },
];

return dashboard;
