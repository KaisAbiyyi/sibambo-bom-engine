# Baseline Reproduction Report

## Environment Details
- **OS**: Windows
- **Node Version**: v22.23.1
- **Bun Version**: 1.3.14
- **Model-Eval Version**: 0.0.1
- **SketchUp**: Not Installed (desktop validation bypassed as per environment constraints)

## Corpus Hashes
- **house2_model-eval.json**:
  - Path: `C:\handoff\iteration-3a5-corpus\compact\house2_model-eval.json`
  - SHA256: `52d1c53b73c2e2db8838d168560dae21eb1d66dc4e02878eafa48d87729dd2cd`
  - Byte Size: 290415 bytes
- **presentation20_model-eval.json**:
  - Path: `C:\handoff\iteration-3a5-corpus\compact\presentation20_model-eval.json`
  - SHA256: `c896f681bc3b3ce9fdbaf8ebfcd5f0a8b59f287704898bdc26af6a4e7cfd58e4`
  - Byte Size: 1498069 bytes

## Semantic Baseline Results
- **house2**:
  - Classification Units: 2,843
  - Fingerprint: `200341556e59c20009a50508292ab41e25f8e508b162d7daa5f6a670675988f2`
- **presentation20**:
  - Classification Units: 256,788
  - Fingerprint: `6da1922ff79d22e6e0acaf144d710c04e9e7848ae18c4e450b56897c1d51a562`

## Test Results
- All unit and integration tests passed (81 passing tests).
- Bun run check and Bun run build passed with zero errors.
- Initial FaceRecord expansion is zero (as per compact-loader design).
