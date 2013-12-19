(function() {
  goog.provide('gn_metadata_manager_service');

  goog.require('gn_editor_xml_service');
  goog.require('gn_schema_manager_service');

  var module = angular.module('gn_metadata_manager_service',
      ['gn_schema_manager_service', 'gn_editor_xml_service']);

  module.factory('Metadata', function() {
    function Metadata(k) {
      this.props = $.extend(true, {}, k);
    };

    function formatLink(sLink) {
      var linkInfos = sLink.split('|');
      return {
        name: linkInfos[1],
        url: linkInfos[2],
        desc: linkInfos[0],
        protocol: linkInfos[3],
        contentType: linkInfos[4]
      };
    }
    function parseLink(sLink) {

    };

    Metadata.prototype = {
      getUuid: function() {
        return this.props['geonet:info'].uuid;
      },
      getLinks: function() {
        return this.props.link;
      },
      getLinksByType: function(type) {
        var ret = [];
        angular.forEach(this.props.link, function(link) {
          var linkInfo = formatLink(link);
          if (linkInfo.protocol.indexOf(type) >= 0) {
            ret.push(linkInfo);
          }
        });
        return ret;
      }
    };
    return Metadata;
  });

  /**
   * Contains all the value of the current edited
   * metadata (id, uuid, formId, version etc..)
   */
  module.value('gnCurrentEdit', {});

  module.factory('gnEditor',
      ['$q',
       '$http',
       '$translate',
       '$compile',
       'gnUrlUtils',
       'gnNamespaces',
       'gnXmlTemplates',
       'gnHttp',
       'gnCurrentEdit',
       function($q, $http, $translate, $compile, 
       gnUrlUtils, gnNamespaces, gnXmlTemplates, gnHttp, gnCurrentEdit) {

         /**
         * Animation duration for slide up/down
         */
         var duration = 300;


         var setStatus = function(status) {
           gnCurrentEdit.savedStatus = $translate(status.msg);
           gnCurrentEdit.savedTime = moment();
           gnCurrentEdit.saving = status.saving;
         };
         return {
           buildEditUrlPrefix: function(service) {
             var params = [service, '?id=', gnCurrentEdit.id];
             gnCurrentEdit.tab && params.push('&currTab=', gnCurrentEdit.tab);
             gnCurrentEdit.displayAttributes &&
             params.push('&displayAttributes=',
             gnCurrentEdit.displayAttributes);
             return params.join('');
           },
           /**
            * Save the metadata record currently in editing session.
            *
            * If refreshForm is true, then will also update the current form.
            * This is required while switching tab for example. Update the tab
            * value in the form and trigger save to update the view.
            */
           save: function(refreshForm) {
             var defer = $q.defer();
             var scope = this;
             if (gnCurrentEdit.saving) {
               return;
             } else {
               setStatus({msg: 'saving', saving: true});
             }

             $http.post(
                 refreshForm ? 'md.edit.save' : 'md.edit.saveonly',
                 $(gnCurrentEdit.formId).serialize(),
                 {
                   headers: {'Content-Type':
                     'application/x-www-form-urlencoded'}
                 }).success(function(data) {

               var snippet = $(data);
               if (refreshForm) {
                 scope.refreshEditorForm(snippet);
               }
               setStatus({msg: 'allChangesSaved', saving: false});

               defer.resolve(snippet);
             }).error(function(error) {
               setStatus({msg: 'saveMetadataError', saving: false});
               defer.reject(error);
             });
             return defer.promise;
           },
           /**
            * Cancel the changes
            */
           cancel: function(refreshForm) {
             var defer = $q.defer();
             if (gnCurrentEdit.saving) {
               return;
             } else {
               setStatus({msg: 'cancelling', saving: true});
             }

             $http({
               method: 'GET',
               url: 'md.edit.cancel@json',
               params: {
                 id: gnCurrentEdit.id
               }
             }).success(function(data) {
               setStatus({msg: 'allChangesCanceled', saving: false});

               defer.resolve(data);
             }).error(function(error) {
               setStatus({msg: 'cancelChangesError', saving: false});
               defer.reject(error);
             });
             return defer.promise;
           },

           /**
            * Reload editor with the html snippet given
            * in parameter. If no snippet is provided, then
            * just reload the metadata into the form.
            */
           refreshEditorForm: function(form, startNewSession) {
             var scope = this;
             var refreshForm = function(snippet) {
               $(gnCurrentEdit.formId).replaceWith(snippet);
               // Compiling
               if (gnCurrentEdit.compileScope) {
                 $compile(snippet)(gnCurrentEdit.compileScope);
               }
               scope.onFormLoad();
             };
             if (form) {
               refreshForm(form);
             }
             else {
               var params = {id: gnCurrentEdit.id};

               // If a new session, ask the server to save the original
               // record and update session start time
               if (startNewSession) {
                 angular.extend(params, {starteditingsession: 'yes'});
                 gnCurrentEdit.sessionStartTime = moment();
               }
               gnHttp.callService('edit', params).then(function(data) {
                 refreshForm($(data.data));
               });
             }
           },

           /**
            * Called after the edit form has been loaded.
            * Fill gnCurrentEdit all the info of the current
            * editing session.
            */
           onFormLoad: function() {
             var getInputValue = function(id) {
               return $(gnCurrentEdit.formId).
                   find('input[id="' + id + '"]').val();
             };

             angular.extend(gnCurrentEdit, {
               mdType: getInputValue('template'),
               mdLanguage: getInputValue('language'),
               mdOtherLanguages: getInputValue('otherLanguages'),
               showValidationErrors: getInputValue('showvalidationerrors'),
               uuid: getInputValue('uuid'),
               version: getInputValue('version')
             });

           },
           //TODO : move edit services to new editor service
           /**
           * Add another element or attribute
           * of the same type to the metadata record.
           *
           * Position could be: after (default) or before
           *
           * When attribute is expanded, the returned element contains the field
           * and the element is replaced by the new one with the attribute
           * requested.
           */
           add: function(metadataId, ref, name, 
               insertRef, position, attribute) {
             // for element: md.elem.add?id=1250&ref=41&
             //   name=gmd:presentationForm
             // for attribute md.elem.add?id=19&ref=42&name=gco:nilReason
             //                  &child=geonet:attribute

             var attributeAction = attribute ? '&child=geonet:attribute' : '';
             var defer = $q.defer();
             $http.get(this.buildEditUrlPrefix('md.element.add') +
             '&ref=' + ref + '&name=' + name + attributeAction)
                    .success(function(data) {
               // Append HTML snippet after current element - compile Angular
               var target = $('#gn-el-' + insertRef);
               var snippet = $(data);

               if (attribute) {
                 target.replaceWith(snippet);
               } else {
                 snippet.css('display', 'none');   // Hide
                 target[position || 'after'](snippet); // Insert
                 snippet.slideDown(duration, function() {});   // Slide

                 // Remove the Add control from the current element
                 var addControl = $('#gn-el-' + insertRef + ' .gn-add');
               }
               $compile(snippet)(gnCurrentEdit.compileScope);
               defer.resolve(snippet);

             }).error(function(data) {
               defer.reject(data);
             });

             return defer.promise;
           },
           addChoice: function(metadataId, ref, parent, name, 
               insertRef, position) {
             var defer = $q.defer();
             // md.elem.add?id=1250&ref=41&name=gmd:presentationForm
             $http.get(this.buildEditUrlPrefix('md.element.add') +
                      '&ref=' + ref +
                      '&name=' + parent +
                      '&child=' + name).success(function(data) {
               // Append HTML snippet after current element - compile Angular
               var target = $('#gn-el-' + insertRef);
               var snippet = $(data);

               target[position || 'before'](snippet);

               $compile(snippet)(gnCurrentEdit.compileScope);
               defer.resolve(snippet);
             }).error(function(data) {
               defer.reject(data);
             });
             return defer.promise;
           },
           remove: function(metadataId, ref, parent) {
             // md.element.remove?id=<metadata_id>&ref=50&parent=41
             // Call service to remove element from metadata record in session
             var defer = $q.defer();
             $http.get('md.element.remove@json?id=' + gnCurrentEdit.id +
                     '&ref=' + ref + '&parent=' + parent)
                     .success(function(data) {
               // Remove element from the DOM
               var target = $('#gn-el-' + ref);
               target.slideUp(duration, function() { $(this).remove();});

               // TODO: Take care of moving the + sign
               defer.resolve(data);
             }).error(function(data) {
               defer.reject(data);
             });
             return defer.promise;
           },
           view: function(md) {
             window.open('../../?uuid=' + md['geonet:info'].uuid,
                 'gn-view');
           },
           edit: function(md) {
             location.href = 'catalog.edit?#/metadata/' +
                 md['geonet:info'].id;
           },
           getRecord: function(id) {
             var defer = $q.defer();
             // TODO : replace to use new services
             var url = gnUrlUtils.append('xml.metadata.get',
                 gnUrlUtils.toKeyValue({
                   id: id
                 })
                 );
             $http.get(url).
                 success(function(data, status) {
                   defer.resolve(data);
                 }).
                 error(function(data, status) {
                   //                TODO handle error
                   //                defer.reject(error);
                 });
             return defer.promise;
           },
           /**
            * Build a field name for an XML field
            */
           buildXMLFieldName: function(elementRef, elementName) {
             var t = ['_X', elementRef,
                      '_', elementName.replace(':', 'COLON')];
             return t.join('');
           }
         };
       }]);
})();
