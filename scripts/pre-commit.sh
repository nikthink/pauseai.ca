#!/bin/sh
set -e

hugo
npm run test:links -- --skip-build
npm run test:snapshots -- --skip-build
