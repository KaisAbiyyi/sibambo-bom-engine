#include "traversal.h"
#include "coord.h"
#include "classifier.h"
#include "constants.h"
#include <SketchUpAPI/model/face.h>
#include <SketchUpAPI/model/group.h>
#include <SketchUpAPI/model/component_instance.h>
#include <SketchUpAPI/model/component_definition.h>
#include <vector>

using json = nlohmann::json;

namespace Traversal {

    json buildFace(SUFaceRef face, const SUTransformation& transform) {
        json face_json = json::object();
        face_json["type"] = "Face";
        
        SUVector3D normal = {0, 0, 1};
        SUFaceGetNormal(face, &normal);
        
        SUVector3D world_normal = Coord::transformNormal(normal, transform);
        face_json["surface_type"] = Classifier::classifySurface(world_normal);
        
        double area = 0;
        SUFaceGetArea(face, &area);
        face_json["area_m2"] = area * Constants::IN2_TO_M2;

        SULoopRef outer_loop = SU_INVALID;
        SUFaceGetOuterLoop(face, &outer_loop);
        
        size_t num_vertices = 0;
        SULoopGetNumVertices(outer_loop, &num_vertices);
        std::vector<SUVertexRef> vertices(num_vertices);
        SULoopGetVertices(outer_loop, num_vertices, vertices.data(), &num_vertices);
        
        json vertices_json = json::array();
        for (size_t i = 0; i < num_vertices; ++i) {
            SUPoint3D pt;
            SUVertexGetPosition(vertices[i], &pt);
            
            SUPoint3D world_pt = Coord::transformPoint(pt, transform);
            
            json v_json;
            v_json["position"] = {
                {"x", world_pt.x * Constants::IN_TO_M},
                {"y", world_pt.y * Constants::IN_TO_M},
                {"z", world_pt.z * Constants::IN_TO_M}
            };
            vertices_json.push_back(v_json);
        }
        face_json["vertices"] = vertices_json;
        return face_json;
    }

    json walkEntities(SUEntitiesRef entities, const SUTransformation& parent_transform) {
        json children = json::array();
        
        // Faces
        size_t num_faces = 0;
        SUEntitiesGetNumFaces(entities, &num_faces);
        if (num_faces > 0) {
            std::vector<SUFaceRef> faces(num_faces);
            SUEntitiesGetFaces(entities, num_faces, faces.data(), &num_faces);
            for (size_t i = 0; i < num_faces; ++i) {
                children.push_back(buildFace(faces[i], parent_transform));
            }
        }
        
        // Groups
        size_t num_groups = 0;
        SUEntitiesGetNumGroups(entities, &num_groups);
        if (num_groups > 0) {
            std::vector<SUGroupRef> groups(num_groups);
            SUEntitiesGetGroups(entities, num_groups, groups.data(), &num_groups);
            for (size_t i = 0; i < num_groups; ++i) {
                SUTransformation group_tf;
                SUGroupGetTransform(groups[i], &group_tf);
                SUTransformation world_tf = Coord::multiplyTransforms(parent_transform, group_tf);
                
                SUEntitiesRef group_entities = SU_INVALID;
                SUGroupGetEntities(groups[i], &group_entities);
                
                SUStringRef name = SU_INVALID;
                SUStringCreate(&name);
                SUGroupGetName(groups[i], &name);
                size_t name_len = 0;
                SUStringGetUTF8Length(name, &name_len);
                std::string name_str(name_len, '\0');
                if (name_len > 0) SUStringGetUTF8(name, name_len, &name_str[0], &name_len);
                SUStringRelease(&name);
                
                json group_json;
                group_json["type"] = "Group";
                group_json["name"] = name_str;
                group_json["children"] = walkEntities(group_entities, world_tf);
                children.push_back(group_json);
            }
        }
        
        // Component Instances
        size_t num_instances = 0;
        SUEntitiesGetNumInstances(entities, &num_instances);
        if (num_instances > 0) {
            std::vector<SUComponentInstanceRef> instances(num_instances);
            SUEntitiesGetInstances(entities, num_instances, instances.data(), &num_instances);
            for (size_t i = 0; i < num_instances; ++i) {
                SUTransformation inst_tf;
                SUComponentInstanceGetTransform(instances[i], &inst_tf);
                SUTransformation world_tf = Coord::multiplyTransforms(parent_transform, inst_tf);
                
                SUComponentDefinitionRef def = SU_INVALID;
                SUComponentInstanceGetDefinition(instances[i], &def);
                
                SUEntitiesRef def_entities = SU_INVALID;
                SUComponentDefinitionGetEntities(def, &def_entities);

                SUStringRef name = SU_INVALID;
                SUStringCreate(&name);
                SUComponentInstanceGetName(instances[i], &name);
                size_t name_len = 0;
                SUStringGetUTF8Length(name, &name_len);
                std::string name_str(name_len, '\0');
                if (name_len > 0) SUStringGetUTF8(name, name_len, &name_str[0], &name_len);
                SUStringRelease(&name);

                SUStringRef def_name = SU_INVALID;
                SUStringCreate(&def_name);
                SUComponentDefinitionGetName(def, &def_name);
                size_t def_name_len = 0;
                SUStringGetUTF8Length(def_name, &def_name_len);
                std::string def_name_str(def_name_len, '\0');
                if (def_name_len > 0) SUStringGetUTF8(def_name, def_name_len, &def_name_str[0], &def_name_len);
                SUStringRelease(&def_name);
                
                json inst_json;
                inst_json["type"] = "ComponentInstance";
                inst_json["name"] = name_str.empty() ? def_name_str : name_str;
                inst_json["definition_name"] = def_name_str;
                inst_json["children"] = walkEntities(def_entities, world_tf);
                children.push_back(inst_json);
            }
        }
        
        return children;
    }
}
