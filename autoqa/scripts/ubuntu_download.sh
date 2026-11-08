#!/bin/bash
# Ubuntu download script for Rey30 IDvj app

WORKFLOW_INPUT_URL="$1"
WORKFLOW_INPUT_IS_NIGHTLY="$2"
REPO_VARIABLE_URL="$3"
REPO_VARIABLE_IS_NIGHTLY="$4"
DEFAULT_URL="$5"
DEFAULT_IS_NIGHTLY="$6"

# Determine Rey30 IDvj app URL and nightly flag from multiple sources (priority order):
# 1. Workflow dispatch input (manual trigger)
# 2. Repository variable REY30_APP_URL_LINUX
# 3. Default URL from env

REY30_APP_URL=""
IS_NIGHTLY=false

if [ -n "$WORKFLOW_INPUT_URL" ]; then
    REY30_APP_URL="$WORKFLOW_INPUT_URL"
    IS_NIGHTLY="$WORKFLOW_INPUT_IS_NIGHTLY"
    echo "Using Rey30 IDvj app URL from workflow input: $REY30_APP_URL"
    echo "Is nightly build: $IS_NIGHTLY"
elif [ -n "$REPO_VARIABLE_URL" ]; then
    REY30_APP_URL="$REPO_VARIABLE_URL"
    IS_NIGHTLY="$REPO_VARIABLE_IS_NIGHTLY"
    echo "Using Rey30 IDvj app URL from repository variable: $REY30_APP_URL"
    echo "Is nightly build: $IS_NIGHTLY"
else
    REY30_APP_URL="$DEFAULT_URL"
    IS_NIGHTLY="$DEFAULT_IS_NIGHTLY"
    echo "Using default Rey30 IDvj app URL: $REY30_APP_URL"
    echo "Is nightly build: $IS_NIGHTLY"
fi

# Set environment variables for later steps
echo "REY30_APP_URL=$REY30_APP_URL" >> $GITHUB_ENV
echo "IS_NIGHTLY=$IS_NIGHTLY" >> $GITHUB_ENV

echo "Downloading Rey30 IDvj app from: $REY30_APP_URL"

DOWNLOAD_PATH="/tmp/rey30-installer.deb"

# Download the package
if ! wget "$REY30_APP_URL" -O "$DOWNLOAD_PATH"; then
    echo "Failed to download Rey30 IDvj app"
    exit 1
fi

if [ -f "$DOWNLOAD_PATH" ]; then
    FILE_SIZE=$(stat -c%s "$DOWNLOAD_PATH")
    echo "Downloaded Rey30 IDvj app successfully. Size: $FILE_SIZE bytes"
    echo "File saved to: $DOWNLOAD_PATH"
else
    echo "Downloaded file not found"
    exit 1
fi
