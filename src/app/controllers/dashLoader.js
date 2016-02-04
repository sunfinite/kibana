define([
  'angular',
  'lodash'
],
function (angular, _) {
  'use strict';

  var module = angular.module('kibana.controllers');

  module.controller('dashLoader', function($scope, $http, timer, dashboard, alertSrv) {
    $scope.loader = dashboard.current.loader;

    $scope.init = function() {
      $scope.gist_pattern = /(^\d{5,}$)|(^[a-z0-9]{10,}$)|(gist.github.com(\/*.*)\/[a-z0-9]{5,}\/*$)/;
      $scope.gist = $scope.gist || {};
      $scope.elasticsearch = $scope.elasticsearch || {};
    };

    $scope.showDropdown = function(type) {
      if(_.isUndefined(dashboard.current.loader)) {
        return true;
      }

      var _l = dashboard.current.loader;
      if(type === 'load') {
        return (_l.load_elasticsearch || _l.load_gist || _l.load_local);
      }
      if(type === 'save') {
        return (_l.save_elasticsearch || _l.save_gist || _l.save_local || _l.save_default);
      }
      if(type === 'share') {
        return (_l.save_temp);
      }
      return false;
    };

    $scope.set_default = function() {
      /*if(dashboard.set_default($location.path())) {
        alertSrv.set('Home Set','This page has been set as your default Kibana dashboard','success',5000);
      } else {
        alertSrv.set('Incompatible Browser','Sorry, your browser is too old for this feature','error',5000);
      }*/
      dashboard.northshore_set_default();
    };

    $scope.get_pdf = function() {
      dashboard.get_pdf();
    };

    $scope.add_email = function() {
      dashboard.add_email();
    };

    $scope.remove_email = function() {
      dashboard.remove_email();
    };

    $scope.fetch_saved_queries = function() {
      dashboard.fetch_saved_queries();
    };

    $scope.fetch_frequent_dashboards = function() {
      dashboard.fetch_frequent_dashboards();
    };

    $scope.save_query = function(index) {
      dashboard.save_query(index);
    };

    $scope.select_query = function(index) {
      dashboard.select_query(index);
    };

    $scope.select_dashboard = function(index) {
      dashboard.select_dashboard(index);
    };

    $scope.delete_query = function(index) {
      dashboard.delete_query(index);
    };

    $scope.purge_default = function() {
      if(dashboard.purge_default()) {
        alertSrv.set('Local Default Clear','Your Kibana default dashboard has been reset to the default',
          'success',5000);
      } else {
        alertSrv.set('Incompatible Browser','Sorry, your browser is too old for this feature','error',5000);
      }
    };

    $scope.load_default = function() {
      dashboard.northshore_load_default();
    };

    $scope.elasticsearch_save = function(type,ttl) {
      var save_func = type === 'temp' ? dashboard.elasticsearch_save : dashboard.northshore_elasticsearch_save;
      dashboard.current.showLoader = true;
      save_func(
        type,
        ($scope.elasticsearch.title || dashboard.current.title),
        ($scope.loader.save_temp_ttl_enable ? ttl : false)
      ).then(
        function(result) {
        dashboard.current.showLoader = false;
        result = result.data || result;
        if(!_.isUndefined(result)) {
          if(!_.isUndefined(result._id)) {
            alertSrv.set('Dashboard Saved','This dashboard has been saved to Elasticsearch as "' +
              result._id + '"','success',5000);
            if(type === 'temp') {
              $scope.share = dashboard.share_link(dashboard.current.title,'temp',result._id);
            }
          }
        } else {
          alertSrv.set('Save failed','Dashboard could not be saved to Elasticsearch','error',5000);
        }
      });
    };

    $scope.elasticsearch_delete = function(id) {
      dashboard.current.showLoader = true;
      dashboard.northshore_elasticsearch_delete(id).then(
        function(result) {
          dashboard.current.showLoader = false;
          result = result.data || result;
          if(!_.isUndefined(result)) {
            if(result.found) {
              alertSrv.set('Dashboard Deleted',id+' has been deleted','success',5000);
              // Find the deleted dashboard in the cached list and remove it
              var toDelete = _.where($scope.elasticsearch.dashboards,{_id:id})[0];
              $scope.elasticsearch.dashboards = _.without($scope.elasticsearch.dashboards,toDelete);
            } else {
              alertSrv.set('Dashboard Not Found','Could not find '+id+' in Elasticsearch','warning',5000);
            }
          } else {
            alertSrv.set('Dashboard Not Deleted','An error occurred deleting the dashboard','error',5000);
          }
        }
      );
    };

    $scope.elasticsearch_dblist = function(query) {
      dashboard.current.showLoader = true;
      dashboard.elasticsearch_list(query,$scope.loader.load_elasticsearch_size).then(
        function(result) {
        dashboard.current.showLoader = false;
        if(!_.isUndefined(result.hits)) {
          $scope.hits = result.hits.total;
          $scope.elasticsearch.dashboards = result.hits.hits;
        }
      });
    };

    $scope.save_gist = function() {
      dashboard.save_gist($scope.gist.title).then(
        function(link) {
        if(!_.isUndefined(link)) {
          $scope.gist.last = link;
          alertSrv.set('Gist saved','You will be able to access your exported dashboard file at '+
            '<a href="'+link+'">'+link+'</a> in a moment','success');
        } else {
          alertSrv.set('Save failed','Gist could not be saved','error',5000);
        }
      });
    };

    $scope.gist_dblist = function(id) {
      dashboard.gist_list(id).then(
        function(files) {
        if(files && files.length > 0) {
          $scope.gist.files = files;
        } else {
          alertSrv.set('Gist Failed','Could not retrieve dashboard list from gist','error',5000);
        }
      });
    };

  });

});
