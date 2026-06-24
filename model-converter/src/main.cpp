#include <iostream>
#include <SketchUpAPI/initialize.h>
#include <SketchUpAPI/model/model.h>
#include <SketchUpAPI/model/entities.h>
#include "nlohmann/json.hpp"
#include "traversal.h"

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: archiparse <input.skp>\n";
        return 1;
    }
    
    SUInitialize();
    
    SUModelRef model = SU_INVALID;
    SUResult res = SUModelCreateFromFile(&model, argv[1]);
    if (res != SU_ERROR_NONE) {
        std::cerr << "Failed to load model: " << argv[1] << "\n";
        SUTerminate();
        return 1;
    }
    
    SUEntitiesRef entities = SU_INVALID;
    SUModelGetEntities(model, &entities);
    
    // Identity transform
    SUTransformation identity;
    identity.values[0] = 1.0; identity.values[1] = 0.0; identity.values[2] = 0.0; identity.values[3] = 0.0;
    identity.values[4] = 0.0; identity.values[5] = 1.0; identity.values[6] = 0.0; identity.values[7] = 0.0;
    identity.values[8] = 0.0; identity.values[9] = 0.0; identity.values[10] = 1.0; identity.values[11] = 0.0;
    identity.values[12] = 0.0; identity.values[13] = 0.0; identity.values[14] = 0.0; identity.values[15] = 1.0;
    
    nlohmann::json root = nlohmann::json::object();
    root["schema_version"] = "2.0";
    root["export_level"] = "visual";
    root["entities"] = Traversal::walkEntities(entities, identity);
    
    std::cout << root.dump(2) << std::endl;
    
    SUModelRelease(&model);
    SUTerminate();
    
    return 0;
}
