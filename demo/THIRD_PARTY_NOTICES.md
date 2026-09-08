# Third-party notices

## OpenMAIC generation

This application uses `@openmaic/generation` 0.3.6 from
[THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC), licensed under the
MIT License.

Copyright (c) 2026 THU-MAIC

The package is used for bounded generation retry classification and repair of
structured JSON returned by language models. The application keeps its own
teaching-domain validation, source binding, request deadline, and retry limit.
The complete upstream license is distributed with the installed package.

## OpenMAIC storage

The Cloudflare Agent Runtime uses `@openmaic/storage` 0.29.0 from the same
MIT-licensed project for PostgreSQL-backed session leases, lifecycle events,
cancellation, and replay cursors. The complete upstream license is distributed
with the installed package.

## OpenMAIC slide canvas

The teaching slide workbench uses `@openmaic/dsl` 0.11.1,
`@openmaic/editor` 0.0.5, and `@openmaic/renderer` 0.1.6 from the same
MIT-licensed project. They provide the slide document model, direct-manipulation
canvas, official renderer, thumbnails, image snapshots, fonts, and equation
rendering integration. The complete upstream license is distributed with the
installed packages.

## KaTeX

The slide canvas uses KaTeX 0.16.33, licensed under the MIT License, to render
mathematical notation.

Copyright (c) 2013-2020 Khan Academy and other contributors

The complete license is distributed with the installed package.
