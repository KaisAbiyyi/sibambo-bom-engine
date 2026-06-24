#pragma once
#include <SketchUpAPI/geometry.h>

namespace Coord {
    SUPoint3D transformPoint(const SUPoint3D& pt, const SUTransformation& tf);
    SUVector3D transformNormal(const SUVector3D& normal, const SUTransformation& tf);
    SUTransformation multiplyTransforms(const SUTransformation& t1, const SUTransformation& t2);
}
