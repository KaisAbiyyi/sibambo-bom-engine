#pragma once
#include <SketchUpAPI/model/entities.h>
#include <SketchUpAPI/geometry.h>
#include "nlohmann/json.hpp"

namespace Traversal {
    nlohmann::json walkEntities(SUEntitiesRef entities, const SUTransformation& parent_transform);
}
