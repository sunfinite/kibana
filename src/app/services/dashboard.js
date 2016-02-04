define([
  'angular',
  'jquery',
  'kbn',
  'lodash',
  'config',
  'moment',
  'modernizr',
  'filesaver',
  'blob'
],

function (angular, $, kbn, _, config, moment, Modernizr) {
  'use strict';

  var module = angular.module('kibana.services');

  module.service('dashboard', function(
    $routeParams, $http, $rootScope, $injector, $location, $timeout,
    ejsResource, timer, kbnIndex, alertSrv, esVersion, esMinVersion
  ) {
    // A hash of defaults to use when loading a dashboard

    var _dash = {
      title: "",
      style: "dark",
      editable: true,
      failover: false,
      panel_hints: true,
      rows: [],
      pulldowns: [
        {
          type: 'query',
        },
        {
          type: 'filtering'
        }
      ],
      nav: [
        {
          type: 'timepicker'
        }
      ],
      services: {},
      loader: {
        save_gist: false,
        save_elasticsearch: true,
        save_local: true,
        save_default: true,
        save_temp: true,
        save_temp_ttl_enable: true,
        save_temp_ttl: '30d',
        load_gist: false,
        load_elasticsearch: true,
        load_elasticsearch_size: 20,
        load_local: false,
        hide: false
      },
      index: {
        interval: 'none',
        pattern: '_all',
        default: 'INDEX_MISSING',
        warm_fields: true
      },
      refresh: false
    };

    var index = '',
        logmon_id = '',
        query = '',
        name = '',
        email_dashboards = [],
        displayButtons = true,
        active = false,
        admin_email = 'northshore-log-dev@akamai.com',
        user = 'transient',
        isGroup = false;

    if ($location.search().index) {
      index = $location.search().index;
    }

    if ($location.search().query) {
      query = $location.search().query;
    }

    if ($location.search().name) {
      name = $location.search().name;
    }

    if ($location.search().id) {
      logmon_id = $location.search().id;
    }

    if ($location.search().group) {
      if ($location.search().group === '1') {
        isGroup = true;
      }
    }

    if ($location.search().active) {
      if ($location.search().active === '1') {
        active = true;
      }
    }
      
    if ($location.search().display) {
      if ($location.search().display === '0') {
        displayButtons = false;
      }
    }

    if ($location.search().email) {
      email_dashboards = $location.search().email.split(',');
    }

    if ($location.search().admin) {
      admin_email = $location.search().admin_email;
    }

    if ($location.search().user) {
      user = $location.search().user;
    }

    
    // An elasticJS client to use
    var ejs = ejsResource(config.elasticsearch);

    var gist_pattern = /(^\d{5,}$)|(^[a-z0-9]{10,}$)|(gist.github.com(\/*.*)\/[a-z0-9]{5,}\/*$)/;

    // Store a reference to this
    var self = this;
    var filterSrv,querySrv;

    this.current = _.clone(_dash);
    this.last = {};
    this.availablePanels = [];

    $rootScope.$on('$routeChangeSuccess',function(){
      // Clear the current dashboard to prevent reloading
      self.current = {};
      self.indices = [];
      esVersion.isMinimum().then(function(isMinimum) {
        if(_.isUndefined(isMinimum)) {
          return;
        }
        if(isMinimum) {
          route();
        } else {
          alertSrv.set('Upgrade Required',"Your version of Elasticsearch is too old. Kibana requires" +
            " Elasticsearch " + esMinVersion + " or above.", "error");
        }
      });
    });

    var route = function() {
      // Is there a dashboard type and id in the URL?
      if(!(_.isUndefined($routeParams.kbnType)) && !(_.isUndefined($routeParams.kbnId))) {
        var _type = $routeParams.kbnType;
        var _id = $routeParams.kbnId;

        switch(_type) {
        case ('elasticsearch'):
          self.elasticsearch_load('dashboard',_id);
          break;
        case ('temp'):
          self.elasticsearch_load('temp',_id);
          break;
        case ('file'):
          self.file_load(_id);
          break;
        case('script'):
          self.script_load(_id);
          break;
        case('local'):
          self.local_load();
          break;
        default:
          $location.path(config.default_route);
        }
      // No dashboard in the URL
      } else {
        // Check if browser supports localstorage, and if there's an old dashboard. If there is,
        // inform the user that they should save their dashboard to Elasticsearch and then set that
        // as their default
        if (Modernizr.localstorage) {
          if(!(_.isUndefined(window.localStorage['dashboard'])) && window.localStorage['dashboard'] !== '') {
            $location.path(config.default_route);
            alertSrv.set('Saving to browser storage has been replaced',' with saving to Elasticsearch.'+
              ' Click <a href="#/dashboard/local/deprecated">here</a> to load your old dashboard anyway.');
          } else if(!(_.isUndefined(window.localStorage.kibanaDashboardDefault))) {
            $location.path(window.localStorage.kibanaDashboardDefault);
          } else {
            $location.path(config.default_route);
          }
        // No? Ok, grab the default route, its all we have now
        } else {
          $location.path(config.default_route);
        }
      }
    };

    // Since the dashboard is responsible for index computation, we can compute and assign the indices
    // here before telling the panels to refresh
    this.refresh = function() {
      if(self.current.index.interval !== 'none') {
        if(_.isUndefined(filterSrv)) {
          return;
        }
        if(filterSrv.idsByType('time').length > 0) {
          var _range = filterSrv.timeRange('last');
          kbnIndex.indices(_range.from,_range.to,
            self.current.index.pattern,self.current.index.interval
          ).then(function (p) {
            if(p.length > 0) {
              self.indices = p;
            } else {
              // Option to not failover
              if(self.current.failover) {
                self.indices = [self.current.index.default];
              } else {
                // Do not issue refresh if no indices match. This should be removed when panels
                // properly understand when no indices are present
                alertSrv.set('No results','There were no results because no indices were found that match your'+
                  ' selected time span','info',5000);
                return false;
              }
            }
            // Don't resolve queries until indices are updated
            querySrv.resolve().then(function(){$rootScope.$broadcast('refresh');});
          });
        } else {
          if(self.current.failover) {
            self.indices = [self.current.index.default];
            querySrv.resolve().then(function(){$rootScope.$broadcast('refresh');});
          } else {
            alertSrv.set("No time filter",
              'Timestamped indices are configured without a failover. Waiting for time filter.',
              'info',5000);
          }
        }
      } else {
        self.indices = [self.current.index.default];
        querySrv.resolve().then(function(){$rootScope.$broadcast('refresh');});
      }
    };

    var dash_defaults = function(dashboard) {
      _.defaults(dashboard,_dash);
      _.defaults(dashboard.index,_dash.index);
      _.defaults(dashboard.loader,_dash.loader);
      return _.cloneDeep(dashboard);
    };

    this.dash_load = function(dashboard) {

      // Cancel all timers
      timer.cancel_all();

      // Make sure the dashboard being loaded has everything required
      dashboard = dash_defaults(dashboard);
      dashboard.index.default = index;

      if (query) {
        dashboard.services.query = {
          list : { 0: { query: query, id: 0 } },
          ids : [0]
        };
      }
      
      // If not using time based indices, use the default index
      if(dashboard.index.interval === 'none') {
        self.indices = [dashboard.index.default];
      }

      // Set the current dashboard
      self.current = _.clone(dashboard);

      // NORTHSHORE: Remember this processor's default to come back to on pressing home
      if (!self.default) {
        self.default = _.clone(self.current);
      }

      // Delay this until we're sure that querySrv and filterSrv are ready
      $timeout(function() {
        // Ok, now that we've setup the current dashboard, we can inject our services
        if(!_.isUndefined(self.current.services.query)) {
          querySrv = $injector.get('querySrv');
          querySrv.init();
        }
        if(!_.isUndefined(self.current.services.filter)) {
          filterSrv = $injector.get('filterSrv');
          filterSrv.init();
        }
      },0).then(function() {
        // Call refresh to calculate the indices and notify the panels that we're ready to roll
        self.refresh();
      });

      if(dashboard.refresh) {
        self.set_interval(dashboard.refresh);
      }

      // Set the available panels for the "Add Panel" drop down
      self.availablePanels = _.difference(config.panel_names,
        _.pluck(_.union(self.current.nav,self.current.pulldowns),'type'));

      // Take out any that we're not allowed to add from the gui.
      self.availablePanels = _.difference(self.availablePanels,config.hidden_panels);
      self.current.displayPDF = true;
      self.current.isDefault = false;
      self.current.showLoader = false;
      if (self.current.title === self.default.title) {
        self.current.isDefault = true;
      }
      if (name) {
        self.current.processorName = name + ' - ';
      }
      self.current.displayButtons = displayButtons;
      if (!active) {
        self.current.addEmail = undefined;
      }
      else {
        if (email_dashboards.indexOf(self.current.title) > -1) {
          self.current.addEmail = false;
        }
        else {
          self.current.addEmail = true;
        }
      }

      // Pliny: Move the parent's scroll when a modal pops up at the top of the dashboard.
      $('body').on('show', '.modal', function() { 
        var $iframe = $(window.parent.document).find('iframe');
        if ($iframe.length > 0) {
          window.parent.$('body').animate({scrollTop: $iframe.offset().top});
        }
      });

      return true;

    };



    this.show_error = function(msg) {
      if(!msg) {
        msg = ('Sorry, we could not set ' + self.current.title + 
               ' as your default dashboard. Please try again. ' +
               'Contact ' + admin_email + ' if the problem persists.');
      }
      alertSrv.set("Error", msg, "error");
    };

    this.make_northshore_request = function(end_point, success_msg, error_msg, callback) {
      // One day, we too will keep all our data on ES. 
      self.current.showLoader = true;
      success_msg = success_msg.replace('DASHBOARD', self.current.title);
      error_msg = error_msg.replace('DASHBOARD', self.current.title);
      var display_timeout = 5000;

      error_msg += ' Please try again. Contact ' + admin_email +' if problem persists.';
      $http.post(
        window.location.protocol + "//" + window.location.host + '/logmon/' + end_point + '/' +  logmon_id,
        {"id": end_point === 'get_pdf' ? self.pdf_id : self.current.title,
         "title": self.current.title, "group": isGroup}
        ).
        success(function(data) {
          if (data === 'true') {
            if(callback) {
              callback();
            }
            alertSrv.set('Yay!', success_msg, 'success', display_timeout);
          }
          else {
            alertSrv.set('Error', error_msg, 'error', display_timeout);
          }
          self.current.showLoader = false;
        }).
        error(function() {
          alertSrv.set('Error', error_msg, 'error', display_timeout);
          self.current.showLoader = false;
        });
    };

    this.fetch_admin_email = function() {
      $http.get(
        window.location.protocol + "//" + window.location.host + '/logmon/get_admin_email/'
      ).
        success(function(data) {
          self.admin_email = data;
        }).
        error(function(e) {
          console.log("Error fetching admin email" + e);
        });
    };

    this.fetch_frequent_dashboards = function() {
      if (!self.admin_email) {
        self.fetch_admin_email();
      }
      self.fetching_frequent_dashboards = true;
      $http.get(
        window.location.protocol + "//" + window.location.host + '/logmon/list_frequent_dashboards/'
      ).
        success(function(data) {
          self.frequent_dashboards = data;
          self.fetching_frequent_dashboards = false;
        }).
        error(function(e) {
          console.log("Error fetching frequent dashboards" + e);
          self.fetching_frequent_dashboards = false;
        });
    };

    this.select_dashboard = function(index) {
      console.log(self.frequent_dashboards[index].name);
    };

    this.fetch_saved_queries = function() {
      self.fetching_queries = true;
      self.fetch_queries_error = false;
      self.save_new_query_message = '';
      $http.get(
        window.location.protocol + "//" + window.location.host + '/logmon/list_queries/'
      ).
        success(function(data) {
          self.saved_queries = data;
          // store original index for correct lookups even if queries are filtered
          for (var i=0; i<self.saved_queries.length; i++) {
            self.saved_queries[i].index = i;
          }
          self.fetching_queries = false;
        }).
        error(function(e) {
          console.log(e);
          self.fetching_queries = false;
          self.fetch_queries_error = true;
        });
    };

    this.save_query = function(index) {
      var query, name;
      if (index >= 0) {
        query = self.saved_queries[index].query;
        if (!query) {
          self.saved_queries[index].message = "Query cannot be empty";
          return false;
        }
        name = self.saved_queries[index].name;
        self.saved_queries[index].message = 'Saving...';
      }
      else {
        self.save_new_query_message = '';
        if (!(self.save_new_query_name ||  self.save_new_query_query)) {
          self.save_new_query_message = "Please enter both the query and an alias for it";
          return false;
        }
        query = self.save_new_query_query;
        name = self.save_new_query_name;
        self.save_new_query_message = 'Saving...';
      }
      var obj = { "query": query, "name": name };
      $http.post(
        window.location.protocol + "//" + window.location.host + '/logmon/save_query/', obj).
        success(function(data) {
            
          if (data.match(/updated/i)) {
            if (index >= 0) {
              self.saved_queries[index].message = data;
            }
            else {
              var old_obj = $.grep(self.saved_queries, function(q) { return q.name === self.save_new_query_name; });
              if (old_obj.length > 0) {
                old_obj[0].query = self.save_new_query_query;
                self.save_new_query_message = data;
              }
            }
          }
          else {
            self.saved_queries.push(obj);
            self.save_new_query_message = data;
          }
        }).
        error(function(e) {
          if (index >= 0) {
            self.saved_queries[index].message = "Error saving query: " + e;
          }
          else {
            self.current.save_query_message = "Error saving query: " + e;
          }
        });
    };

    this.select_query = function(index) {
      var obj = {
        'query': self.saved_queries[index].query,
        'alias': self.saved_queries[index].name
      };
      querySrv.set(obj);
      querySrv.resolve().then(function(){$rootScope.$broadcast('refresh');});
    };

    this.delete_query = function(index) {
      self.saved_queries[index].message = 'Deleting...';
      var obj = {"name": self.saved_queries[index].name};
      $http.post(window.location.protocol + "//" + window.location.host + '/logmon/delete_query/', obj).
        success(function(data) {
          self.save_new_query_message = data;
          self.saved_queries.splice(index, 1);
        }).
        error(function(e) {
          console.log(e);
          self.saved_queries[index].message = "Error deleting query: " + e;
        });
    };

    this.northshore_set_default = function() {
      self.make_northshore_request('set_default', 
                                   'This is your new default dashboard.',
                                   'Sorry, we could not set DASHBOARD as your default.',
                                   function() { self.default = _.clone(self.current); self.current.isDefault = true; });
    };

    this.northshore_load_default = function() {
      self.dash_load(self.default);
    };

    this.get_pdf = function() {
      self.elasticsearch_save('temp', self.current.title, 50000).then(
        function(result) {
        if(!_.isUndefined(result)) {
          if(!_.isUndefined(result._id)) {
            self.pdf_id = result._id;
            self.make_northshore_request('get_pdf',
                                   'PDF request was successful. We will email it to you soon.',
                                   'Sorry, we could not process your PDF request.');
          }
        } else {
          alertSrv.set('Error','Sorry, we could not process your PDF request.','error',5000);
        }
      });
    };

    this.add_email = function() {
      self.make_northshore_request('add_email', 
                                   'DASHBOARD has been added to your email report.',
                                   'Sorry, we could not add DASHBOARD to your email report.',
                                   function() { email_dashboards.push(self.current.title); self.current.addEmail = false; });
    };

    this.remove_email = function() {
      self.make_northshore_request('remove_email', 
                                   'DASHBOARD has been removed from your email report.',
                                   'Sorry, we could not remove DASHBOARD from your email report.',
                                    function() { 
                                      email_dashboards.splice(email_dashboards.indexOf(self.current.title), 1);
                                      self.current.addEmail = true; 
                                    });
    };

    this.gist_id = function(string) {
      if(self.is_gist(string)) {
        return string.match(gist_pattern)[0].replace(/.*\//, '');
      }
    };

    this.is_gist = function(string) {
      if(!_.isUndefined(string) && string !== '' && !_.isNull(string.match(gist_pattern))) {
        return string.match(gist_pattern).length > 0 ? true : false;
      } else {
        return false;
      }
    };

    this.to_file = function() {
      var blob = new Blob([angular.toJson(self.current,true)], {type: "application/json;charset=utf-8"});
      // from filesaver.js
      window.saveAs(blob, self.current.title+"-"+new Date().getTime());
      return true;
    };

    this.set_default = function(route) {
      if (Modernizr.localstorage) {
        // Purge any old dashboards
        if(!_.isUndefined(window.localStorage['dashboard'])) {
          delete window.localStorage['dashboard'];
        }
        window.localStorage.kibanaDashboardDefault = route;
        
      } else {
        return false;
      }
    };

    this.purge_default = function() {
      if (Modernizr.localstorage) {
        // Purge any old dashboards
        if(!_.isUndefined(window.localStorage['dashboard'])) {

          delete window.localStorage['dashboard'];
        }
        delete window.localStorage.kibanaDashboardDefault;
        return true;
      } else {
        return false;
      }
    };

    // TOFIX: Pretty sure this breaks when you're on a saved dashboard already
    this.share_link = function(title,type,id) {
      // replacing window.location
      var northshore_share = document.referrer;
      var index = northshore_share.indexOf('?');
      var new_location = index > 0 ? northshore_share.substr(0, index) : northshore_share;
      return {
        location  : new_location,
        type      : type,
        id        : id,
        link      : new_location +"?dashboard=" + encodeURI(id) + "&type=" + type,
        title     : title
      };
    };

    var renderTemplate = function(json,params) {
      var _r;
      _.templateSettings = {interpolate : /\{\{(.+?)\}\}/g};
      var template = _.template(json);
      var rendered = template({ARGS:params});
      try {
        _r = angular.fromJson(rendered);
      } catch(e) {
        _r = false;
      }
      return _r;
    };

    this.local_load = function() {
      var dashboard = JSON.parse(window.localStorage['dashboard']);
      dashboard.rows.unshift({
        height: "30",
        title: "Deprecation Notice",
        panels: [
          {
            title: 'WARNING: Legacy dashboard',
            type: 'text',
            span: 12,
            mode: 'html',
            content: 'This dashboard has been loaded from the browsers local cache. If you use '+
            'another brower or computer you will not be able to access it! '+
            '\n\n  <h4>Good news!</h4> Kibana'+
            ' now stores saved dashboards in Elasticsearch. Click the <i class="icon-save"></i> '+
            'button in the top left to save this dashboard. Then select "Set as Home" from'+
            ' the "advanced" sub menu to automatically use the stored dashboard as your Kibana '+
            'landing page afterwards'+
            '<br><br><strong>Tip:</strong> You may with to remove this row before saving!'
          }
        ]
      });
      self.dash_load(dashboard);
    };

    this.file_load = function(file) {
      return $http({
        url: "app/dashboards/"+file.replace(/\.(?!json)/,"/")+'?' + new Date().getTime(),
        method: "GET",
        transformResponse: function(response) {
          return renderTemplate(response,$routeParams);
        }
      }).then(function(result) {
        if(!result) {
          return false;
        }
        self.dash_load(dash_defaults(result.data));
        return true;
      },function() {
        alertSrv.set('Error',"Could not load <i>dashboards/"+file+"</i>. Please make sure it exists" ,'error');
        return false;
      });
    };

    this.elasticsearch_load = function(type,id) {
      var successcb = function(data) {
        var response = renderTemplate(angular.fromJson(data)._source.dashboard, $routeParams);
        self.dash_load(response);
      };
      var errorcb = function(data, status) {
        if(status === 0) {
          alertSrv.set('Error',"Could not contact Elasticsearch at "+ejs.config.server+
            ". Please ensure that Elasticsearch is reachable from your system." ,'error');
        } else {
          alertSrv.set('Error',"Could not find "+id+". If you"+
            " are using a proxy, ensure it is configured correctly",'error');
        }
        return false;
      };

      ejs.client.get(
        "/" + config.kibana_index + "/"+type+"/"+id+'?' + new Date().getTime(),
        null, successcb, errorcb);

    };

    this.script_load = function(file) {
      return $http({
        url: "app/dashboards/"+file.replace(/\.(?!js)/,"/"),
        method: "GET",
        transformResponse: function(response) {
          /*jshint -W054 */
          var _f = new Function('ARGS','kbn','_','moment','window','document','angular','require','define','$','jQuery',response);
          return _f($routeParams,kbn,_,moment);
        }
      }).then(function(result) {
        if(!result) {
          return false;
        }
        self.dash_load(dash_defaults(result.data));
        return true;
      },function() {
        alertSrv.set('Error',
          "Could not load <i>scripts/"+file+"</i>. Please make sure it exists and returns a valid dashboard" ,
          'error');
        return false;
      });
    };

    this.elasticsearch_save = function(type,title,ttl) {
      // Clone object so we can modify it without influencing the existing obejct
      var save = _.clone(self.current);
      var id;

      // Change title on object clone
      if (type === 'dashboard') {
        id = save.title = _.isUndefined(title) ? self.current.title : title;
      }

      // Create request with id as title. Rethink this.
      var request = ejs.Document(config.kibana_index,type,id).source({
        user: 'guest',
        group: 'guest',
        title: save.title,
        dashboard: angular.toJson(save)
      });

      request = type === 'temp' && ttl ? request.ttl(ttl) : request;

      return request.doIndex(
        // Success
        function(result) {
          if(type === 'dashboard') {
            $location.path('/dashboard/elasticsearch/'+title);
          }
          return result;
        },
        // Failure
        function() {
          return false;
        }
      );
    };

    this.elasticsearch_delete = function(id) {
      return ejs.Document(config.kibana_index,'dashboard',id).doDelete(
        // Success
        function(result) {
          return result;
        },
        // Failure
        function() {
          return false;
        }
      );
    };

    this.northshore_elasticsearch_save = function(type,title) {
      // Clone object so we can modify it without influencing the existing obejct
      var save = _.clone(self.current);
      var id;

      // Change title on object clone
      if (type === 'dashboard') {
        id = save.title = _.isUndefined(title) ? self.current.title : title;
      }

      return $http.post(
        window.location.protocol + "//" + window.location.host + '/logmon/save_dashboard',
        {
          "title": save.title,
          "dashboard": angular.toJson(save)
        }
      ).
        success(function(data) {
          if (save.title !== self.default.title) {
            self.current.isDefault = false;
          }
          return data;
        }).
        error(function(data, status) {
          var msg;
          if (status === 403) {
            msg = 'Permission error.';
            msg += 'If you are trying to edit an existing dashboard which was not created by you, please save it with a different name.';
          }
          else {
            msg = 'Dashboard could not be saved. Error was: ' + data;
          }
          msg += ' Please contact ' + admin_email + ' if problem persists.';
          alertSrv.set('Save failed',msg,'error',25000);
          return false;
        });
    };

    this.northshore_elasticsearch_delete = function(id) {
      return $http.post(
        window.location.protocol + "//" + window.location.host + '/logmon/delete_dashboard',
        {
          "id": id
        }
      ).
        success(function(data) {
          return data;
        }).
        error(function(data, status) {
          var msg;
          if (status === 403) {
            msg = 'Permission error. You cannot delete a dashboard you did not create.';
          }
          else {
            msg = 'Dashboard could not be deleted. Error was: ' + data;
          }
          msg += ' Please contact ' + admin_email + ' if problem persists.';
          alertSrv.set('Delete failed',msg,'error',25000);
          return false;
        });
    };

    this.elasticsearch_list = function(query,count) {
      var request = ejs.Request().indices(config.kibana_index).types('dashboard');
      return request.query(
        ejs.QueryStringQuery(query || '*')
        ).size(count).doSearch(
          // Success
          function(result) {
            return result;
          },
          // Failure
          function() {
            return false;
          }
        );
    };

    this.save_gist = function(title,dashboard) {
      var save = _.clone(dashboard || self.current);
      save.title = title || self.current.title;
      return $http({
        url: "https://api.github.com/gists",
        method: "POST",
        data: {
          "description": save.title,
          "public": false,
          "files": {
            "kibana-dashboard.json": {
              "content": angular.toJson(save,true)
            }
          }
        }
      }).then(function(data) {
        return data.data.html_url;
      }, function() {
        return false;
      });
    };

    this.gist_list = function(id) {
      return $http.jsonp("https://api.github.com/gists/"+id+"?callback=JSON_CALLBACK"
      ).then(function(response) {
        var files = [];
        _.each(response.data.data.files,function(v) {
          try {
            var file = JSON.parse(v.content);
            files.push(file);
          } catch(e) {
            return false;
          }
        });
        return files;
      }, function() {
        return false;
      });
    };

    this.start_scheduled_refresh = function (after_ms) {
      timer.cancel(self.refresh_timer);
      self.refresh_timer = timer.register($timeout(function () {
        self.start_scheduled_refresh(after_ms);
        self.refresh();
      }, after_ms));
    };

    this.cancel_scheduled_refresh = function () {
      timer.cancel(self.refresh_timer);
    };

    this.set_interval = function (interval) {
      self.current.refresh = interval;
      if (interval) {
        var _i = kbn.interval_to_ms(interval);
        this.start_scheduled_refresh(_i);
      } else {
        this.cancel_scheduled_refresh();
      }
    };
  });
});
