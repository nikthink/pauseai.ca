#!/usr/bin/env bash

hugoBuildFlags="--enableGitInfo --panicOnWarning --printI18nWarnings --printPathWarnings $1"

build() {
    rm -rf ./public/ &&
        hugo -b / $hugoBuildFlags &&
        mkdir ./public/archives/ &&
        tar -zcf ./public/archives/pauseai-ca-full-latest.tgz .editorconfig .github/workflows/* ./*
}

build

while inotifywait -e create,modify,delete,move -r --exclude .git/ .; do
    build
done
