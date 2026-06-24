#include "classifier.h"
#include "constants.h"
#include <cmath>

namespace Classifier {
    std::string classifySurface(const SUVector3D& normal) {
        double nx = std::abs(normal.x);
        double ny = std::abs(normal.y);
        double nz = std::abs(normal.z);

        if (nz > Constants::HORIZONTAL_THRESHOLD) {
            return (normal.z > 0) ? "floor" : "ceiling";
        }
        
        if (nz > Constants::ROOF_SLOPE_MIN) {
            return "roof_slope";
        }

        if (nx >= ny) {
            return (normal.x > 0) ? "wall_x_pos" : "wall_x_neg";
        } else {
            return (normal.y > 0) ? "wall_y_pos" : "wall_y_neg";
        }
    }
}
