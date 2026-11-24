# Moodle vendor integration

`@openuji/journey-vendor-moodle` runs journeys against Moodle built from source.
It implements the Web client contract and uses the shared Compose lifecycle; it
contains no browser automation.

| Entry | Kind | Inputs → outputs |
| --- | --- | --- |
| `web/plugin` | client for `webClientContract` | entries are site-relative routes such as `/my/` |
| `build/service` | builds an image from a `source` checkout | `source` → `image` |
| `stack/service` | installs a fresh site on Docker Compose | `image` → `stack`, `identity` |
| `user-tours/service` | imports user tours into the site | `stack` → none (the imported tours are its provenance) |

**Build.** The checkout is copied, never modified. The image is
`moodlehq/moodle-php-apache` (pinned by digest) with the source in
`/var/www/html` and its locked Composer dependencies (`composer install --no-dev`).
Compiled JavaScript is used as committed. The image detects a `public/` web root
(Moodle 5.1 and later). The output records the source identity, with `$release`
as its version, and the sha256 of each file listed in `verifyFiles`.

**Stack.** `startComposeStack` from `@openuji/journey-service-docker/compose`
owns the project, env file, ownership record and release. The bootstrap waits
until the image's entrypoint has started Apache, runs `admin/cli/install.php`,
applies `config` with `admin/cli/cfg.php` and reads it back. It then verifies the
installed release, the source SHA marker, each `verifyFiles` checksum and the
image ID. The Compose file must make the Moodle service wait for a healthy
database (`depends_on: { db: { condition: service_healthy } }`); the stack runs
the installer as soon as the container is up. Options: `project`,
`composeFiles`, `directory`, `environment`, `service` (default `moodle`),
`baseURL`, `site`, `admin`, `database` (PostgreSQL) and `config`.

**User tours.** Each file in `tours` is a Moodle tour export, imported with
`tool_usertours\manager::import_tour_from_json`. A tour with the same name is
replaced, so repeated imports into a long-lived stack do not add copies. With
`disableOthers` (the default) every other tour, including the shipped ones, is
disabled. The service verifies the result.
