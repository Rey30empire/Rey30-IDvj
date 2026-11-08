#!/bin/bash
# Ubuntu install script for Rey30 IDvj app

IS_NIGHTLY="$1"

INSTALLER_PATH="/tmp/rey30-installer.deb"

echo "Installing Rey30 IDvj app..."
echo "Is nightly build: $IS_NIGHTLY"

# Install the .deb package
sudo apt install "$INSTALLER_PATH" -y
sudo apt-get install -f -y

# Wait for installation to complete
sleep 10

echo "[INFO] Waiting for Rey30 IDvj app first initialization (120 seconds)..."
echo "This allows Rey30 IDvj to complete its initial setup and configuration"
sleep 120
echo "[SUCCESS] Initialization wait completed"

# Verify installation based on nightly flag
if [ "$IS_NIGHTLY" = "true" ]; then
    DEFAULT_JAN_PATH="/usr/bin/Rey30-IDvj-nightly"
    PROCESS_NAME="Rey30-IDvj-nightly"
else
    DEFAULT_JAN_PATH="/usr/bin/Rey30-IDvj"
    PROCESS_NAME="Rey30-IDvj"
fi

if [ -f "$DEFAULT_JAN_PATH" ]; then
    echo "Rey30 IDvj app installed successfully at: $DEFAULT_JAN_PATH"
    echo "REY30_APP_PATH=$DEFAULT_JAN_PATH" >> $GITHUB_ENV
    echo "REY30_PROCESS_NAME=$PROCESS_NAME" >> $GITHUB_ENV
else
    echo "Rey30 IDvj app not found at expected location: $DEFAULT_JAN_PATH"
    echo "Will auto-detect during test run"
fi
