## [0.4.9](https://github.com/igor-siergiej/utils/compare/v0.4.8...v0.4.9) (2026-03-11)


### Bug Fixes

* explicitly pass GitHub Packages registry to npm publish commands ([5bc7635](https://github.com/igor-siergiej/utils/commit/5bc7635171135c6fbaa51bfeda2bd1e1bb229434))

## [0.4.8](https://github.com/igor-siergiej/utils/compare/v0.4.7...v0.4.8) (2026-03-11)


### Bug Fixes

* ensure publish-npm checks out latest commits from release job ([53f4e45](https://github.com/igor-siergiej/utils/commit/53f4e453a5579c095c5b6e391a6a1b37fd81e8a6))

## [0.4.7](https://github.com/igor-siergiej/utils/compare/v0.4.6...v0.4.7) (2026-03-11)


### Bug Fixes

* remove unnecessary auth token env vars from workflow for public npm ([6762c08](https://github.com/igor-siergiej/utils/commit/6762c08d3660b0766ba9211f0ffffda023c208b4))

## [0.4.6](https://github.com/igor-siergiej/utils/compare/v0.4.5...v0.4.6) (2026-03-11)


### Bug Fixes

* add packages:write permission to publish-npm job ([4cd4165](https://github.com/igor-siergiej/utils/commit/4cd4165887a5bdb4391e28ff15af22900d81a77c))

## [0.4.5](https://github.com/igor-siergiej/utils/compare/v0.4.4...v0.4.5) (2026-03-11)


### Bug Fixes

* create .npmrc in repo root instead of home directory ([3ec3fb1](https://github.com/igor-siergiej/utils/commit/3ec3fb10b0bcadda57fbab9be1e3d9fa6ddca7f1))

## [0.4.4](https://github.com/igor-siergiej/utils/compare/v0.4.3...v0.4.4) (2026-03-11)


### Bug Fixes

* remove NPM_TOKEN from .yarnrc.yml, rely on .npmrc for auth ([6fccd03](https://github.com/igor-siergiej/utils/commit/6fccd03dcc0dda4f0bec55870b49420da341ae62))

## [0.4.3](https://github.com/igor-siergiej/utils/compare/v0.4.2...v0.4.3) (2026-03-11)


### Bug Fixes

* explicitly create .npmrc with GitHub Packages registry in publish job ([60eac4b](https://github.com/igor-siergiej/utils/commit/60eac4b997c6f2775d7c533bf36e9b2e00be21f3))
* explicitly pass registry URL to yarn npm publish command ([609475c](https://github.com/igor-siergiej/utils/commit/609475c11950fa940e55725773af5a16d6a53b50))
* make NPM_TOKEN optional in .yarnrc.yml with fallback to empty string ([446e2f7](https://github.com/igor-siergiej/utils/commit/446e2f77d4db5c6c2b2f876a6d0724031dcb9277))
* pass GITHUB_TOKEN to setup-node action for GitHub Packages authentication ([7647966](https://github.com/igor-siergiej/utils/commit/7647966d890b18100318e1c327fe418bae242bbb))
* rely on .yarnrc.yml for GitHub Packages registry config instead of setup-node ([419d599](https://github.com/igor-siergiej/utils/commit/419d599d47936e2141a027e042061da67919d5a8))
* use npm publish instead of yarn npm publish with .npmrc auth ([c88f8e7](https://github.com/igor-siergiej/utils/commit/c88f8e74cc981d6b0e04523f8cd3ae99c51f8c8b))
* use NPM_TOKEN instead of NODE_AUTH_TOKEN for GitHub Packages authentication ([1e65267](https://github.com/igor-siergiej/utils/commit/1e652676b07b2795baa398fb5e3ab1457163ffc7))

## [0.4.2](https://github.com/igor-siergiej/utils/compare/v0.4.1...v0.4.2) (2026-03-11)


### Bug Fixes

* update all [@imapps](https://github.com/imapps) references to [@igor-siergiej](https://github.com/igor-siergiej) in config and workflows ([d6fcf26](https://github.com/igor-siergiej/utils/commit/d6fcf26f24a460101a5ebab86488d1350a935db9))

## [0.4.1](https://github.com/igor-siergiej/utils/compare/v0.4.0...v0.4.1) (2026-03-11)


### Bug Fixes

* add NODE_AUTH_TOKEN to publish-npm yarn install step ([a357b18](https://github.com/igor-siergiej/utils/commit/a357b18f3bf52582e8cdd375a7de005038c233d4))

# [0.4.0](https://github.com/igor-siergiej/utils/compare/v0.3.0...v0.4.0) (2026-03-11)


### Bug Fixes

* adapt to use docker runner ([9ca93cb](https://github.com/igor-siergiej/utils/commit/9ca93cb5c2d38347dbfb884b3d8289d78e63d566))
* add git config rewrite for plain HTTPS gitlab.com URLs ([7d7ea68](https://github.com/igor-siergiej/utils/commit/7d7ea68237be4d03d132b1c9f7db790f8ee6b8c9))
* add missing git SSH-to-HTTPS URL rewrites in monorepo semantic-release template ([bd91b23](https://github.com/igor-siergiej/utils/commit/bd91b23bcd37dbe998465552c640a403586df679))
* add private registry variable to bun pipelines ([ed1fb71](https://github.com/igor-siergiej/utils/commit/ed1fb719d7406ae460408d5063b25e930fd2e290))
* add PRIVATE_REGISTRY to docker dind insecure registries ([1534a3c](https://github.com/igor-siergiej/utils/commit/1534a3ca073a7c411da2b8ce08437b3a1514c517))
* add separate build step to stop bumping version if build fails ([9758b4b](https://github.com/igor-siergiej/utils/commit/9758b4b64ea73981d620c94f58e62eb39bbfb25b))
* **ci/cd:** disable TLS verification for docker:27-dind services ([4afbc19](https://github.com/igor-siergiej/utils/commit/4afbc19e9ff57ef9107e45facf622a6b18649fee))
* **ci:** configure DinD to allow insecure registry for private Docker registry ([1cddb8e](https://github.com/igor-siergiej/utils/commit/1cddb8e26554c7799d41fc2d7fbcd00af905af24))
* **ci:** configure git credentials for semantic-release HTTPS authentication ([00b7936](https://github.com/igor-siergiej/utils/commit/00b7936553d44eb5425713ba8c65e279142384d5))
* **ci:** configure semantic-release to use HTTPS authentication ([281cca0](https://github.com/igor-siergiej/utils/commit/281cca0d946bac2ada11f71f8b1491274aada72f))
* **ci:** remove --force from git fetch tags to avoid conflicts ([e8b8621](https://github.com/igor-siergiej/utils/commit/e8b8621b9825938ee5377cebe65cdfcb736847ca))
* correct git config URL rewriting syntax ([7089383](https://github.com/igor-siergiej/utils/commit/70893836fd0c71293de7bf5bce70ae23226206e2))
* correct semantic-release environment variable name ([8e7280f](https://github.com/igor-siergiej/utils/commit/8e7280f353889524cbe76d80db4adf87ec60a9e8))
* **docker-templates:** use port 2375 and disable TLS like shoppingo ([19fb43e](https://github.com/igor-siergiej/utils/commit/19fb43e65985bcf23f092849562b67f60a6a9395))
* force fetch tags to prevent stale cache issues ([d84f089](https://github.com/igor-siergiej/utils/commit/d84f089dd127d79a7d6e182a6b29cd81736ebfe2))
* force HTTPS for git URLs in semantic-release ([a877b5e](https://github.com/igor-siergiej/utils/commit/a877b5ed1439bfda1d04b605c940b7ec66b1c4ed))
* **pipeline:** correct yq syntax for Helm values updates ([ea7846d](https://github.com/igor-siergiej/utils/commit/ea7846d42e23bce90615b5edf439bcaf564f577f))
* **pipeline:** correctly handle tag-only vs full image updates in yq ([e4b72e6](https://github.com/igor-siergiej/utils/commit/e4b72e61432bd1e424801a52c75eba242dd66b6c))
* rename docker build test steps ([b76002d](https://github.com/igor-siergiej/utils/commit/b76002d1b263bfb8f1239609b231b4d3db298e39))
* rewrite HTTPS gitlab.com URLs to include credentials ([9dc3d08](https://github.com/igor-siergiej/utils/commit/9dc3d081ce57409b916c48df5b2f51b8a8efd5f3))
* set SEMANTIC_RELEASE_GIT_REPOSITORY_URL with credentials ([04765e5](https://github.com/igor-siergiej/utils/commit/04765e5f239197fa7c2f124b51bfdd26e2fe4ccc))
* trying https with private registry ([3d0e7c5](https://github.com/igor-siergiej/utils/commit/3d0e7c51e8bfd5213788514725beb5d352428ace))
* update semantic-release config to use GitHub instead of GitLab ([95b3df5](https://github.com/igor-siergiej/utils/commit/95b3df501b227bf110255ac2eb499711c14dd4ea))
* use bun instead of node for version extraction in Bun template ([1e59a90](https://github.com/igor-siergiej/utils/commit/1e59a90f535b30976c2eba201778c17ad71f3ff4))
* use GITHUB_TOKEN instead of GH_TOKEN ([39fc8e9](https://github.com/igor-siergiej/utils/commit/39fc8e9d9791779d456c1195da300d451fe6e10c))
* use proper GitLab CI variable syntax ([95aa8d9](https://github.com/igor-siergiej/utils/commit/95aa8d97fb76f14991fa2d5eec420763b7172aea))
* use public npm registry by default, GitHub Packages only for [@imapps](https://github.com/imapps) ([84073b0](https://github.com/igor-siergiej/utils/commit/84073b08eecbe5030fee44d419715d93c09d4abf))


### Features

* add bun specific templates ([0cf941c](https://github.com/igor-siergiej/utils/commit/0cf941caa6a5a3094b1e0241a80a55f4b3a49e64))
* add updated pipelines with tags script ([79776d1](https://github.com/igor-siergiej/utils/commit/79776d11f50861c265a1a9a21160cbf608f6f9b2))
* added dev servies compose and update registry for bun imgae ([3874bc1](https://github.com/igor-siergiej/utils/commit/3874bc15b47d6837f4937eb387e82c77d02899b5))
* update private registry url ([ae9cc5b](https://github.com/igor-siergiej/utils/commit/ae9cc5b2f0471af18520e9c84ae2ad340af4f1ec))
* use bun image with git ([a611a42](https://github.com/igor-siergiej/utils/commit/a611a4267e8654bcd9b790fe8326c97428809fce))

# [0.3.0](https://gitlab.com/imapps/utils/compare/v0.2.0...v0.3.0) (2025-10-09)


### Bug Fixes

* add app version to build step ([83b1d15](https://gitlab.com/imapps/utils/commit/83b1d1508c9e2633aba9e706271705de156d7756))
* build from new tag ([4178956](https://gitlab.com/imapps/utils/commit/4178956093f6e54c6b0a29171fc49508e86c5269))
* force fetch tags in version-release to prevent cache issues ([24b475f](https://gitlab.com/imapps/utils/commit/24b475f125ee1670347dcf2bd9b2aec316f238a4))
* use HTTPS with CI_JOB_TOKEN for semantic-release git operations ([853b91a](https://gitlab.com/imapps/utils/commit/853b91a567f2c7ea45a88228adadb01dbe9abc81))


### Features

* replace eslint with biome ([ae9f161](https://gitlab.com/imapps/utils/commit/ae9f161d5414c6c656bc1f64940874a465f79603))

# [0.2.0](https://gitlab.com/imapps/utils/compare/v0.1.3...v0.2.0) (2025-10-03)


### Bug Fixes

* add version-release step ([368bd7e](https://gitlab.com/imapps/utils/commit/368bd7ec21f57c349b556e9127d19cd9a62932d3))
* only update versions ([3ca8403](https://gitlab.com/imapps/utils/commit/3ca84031e2acbebac425bbc9318a7db01f46acc7))
* simplify versions steps ([35d1bd6](https://gitlab.com/imapps/utils/commit/35d1bd62dff7a8df09d9d2ab5f1da962d1490964))
* update staging versions in the right place ([12d1357](https://gitlab.com/imapps/utils/commit/12d13570d99879d031dbbfb6a599211b0c28d90b))
* use hard coded deploy user ([8edca7a](https://gitlab.com/imapps/utils/commit/8edca7a0b4215b29ddbf1f0f663d59d3c1154d2a))


### Features

* add dev-dist to ignore paths ([508284d](https://gitlab.com/imapps/utils/commit/508284da1494410404845514e047e1bf782d54af))
* add version release template ([aa9fc1f](https://gitlab.com/imapps/utils/commit/aa9fc1fd7d02ce0444f74214aaf5c078f750dae4))

## [0.1.3](https://gitlab.com/imapps/utils/compare/v0.1.2...v0.1.3) (2025-09-30)


### Bug Fixes

* publish all packages ([1909baf](https://gitlab.com/imapps/utils/commit/1909baf99bc18d2d830d5b06366f4667d3776518))

## [0.1.2](https://gitlab.com/imapps/utils/compare/v0.1.1...v0.1.2) (2025-09-30)


### Bug Fixes

* manually publish packages ([4b1f628](https://gitlab.com/imapps/utils/commit/4b1f6281aab817a82da7c2eecba88941ff166f6d))

## [0.1.1](https://gitlab.com/imapps/utils/compare/v0.1.0...v0.1.1) (2025-09-30)


### Bug Fixes

* publish each package in monorepo ([e778057](https://gitlab.com/imapps/utils/commit/e778057dc0daba73bc77df4509ace20b753d8af6))

# [0.1.0](https://gitlab.com/imapps/utils/compare/v0.0.12...v0.1.0) (2025-09-30)


### Bug Fixes

* remove gitlab releases ([e9338cb](https://gitlab.com/imapps/utils/commit/e9338cbb29ded98efec56ca880560be896abed3d))
* update package registry ([997ad2d](https://gitlab.com/imapps/utils/commit/997ad2d2c0990fc405df13fd54c2edff58c280ef))


### Features

* migrate to semantic-release for automated versioning ([11941f9](https://gitlab.com/imapps/utils/commit/11941f9a432a72ed784ffb8200de40c487b431e0))
