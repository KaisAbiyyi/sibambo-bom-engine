#pragma once
#include <string>
#include <SketchUpAPI/geometry.h>

namespace Classifier {
    std::string classifySurface(const SUVector3D& normal);
}
