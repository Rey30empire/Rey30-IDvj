#!/bin/bash
# Common test runner script

REY30_APP_PATH="$1"
PROCESS_NAME="$2"
RP_TOKEN="$3"
PLATFORM="$4"

echo "Starting Auto QA Tests..."
echo "Platform: $PLATFORM"
echo "Rey30 IDvj app path: $REY30_APP_PATH"
echo "Process name: $PROCESS_NAME"

# Platform-specific setup
if [ "$PLATFORM" = "ubuntu" ]; then
    # Get the current display session
    export DISPLAY=$(w -h | awk 'NR==1 {print $2}')
    echo "Display ID: $DISPLAY"

    # Verify display is working
    if [ -z "$DISPLAY" ]; then
        echo "No display session found, falling back to :0"
        export DISPLAY=:0
    fi

    echo "Using display: $DISPLAY"

    # Test display connection
    xdpyinfo -display $DISPLAY >/dev/null 2>&1 || {
        echo "Display $DISPLAY is not available"
        exit 1
    }

    # Make Rey30 IDvj executable if needed
    if [ -f "/usr/bin/Rey30-IDvj-nightly" ]; then
        sudo chmod +x /usr/bin/Rey30-IDvj-nightly
    fi
    if [ -f "/usr/bin/Rey30-IDvj" ]; then
        sudo chmod +x /usr/bin/Rey30-IDvj
    fi
fi

# macOS specific setup
if [ "$PLATFORM" = "macos" ]; then
    # Verify Rey30 IDvj app path
    if [ ! -f "$REY30_APP_PATH" ]; then
        echo "❌ Rey30 IDvj app not found at: $REY30_APP_PATH"
        echo "Available files in /Applications:"
        ls -la /Applications/ | grep -i rey30 || echo "No Rey30 IDvj apps found"
        exit 1
    fi
fi

# Change to autoqa directory to ensure correct working directory
cd "$(dirname "$0")/.."
echo "Current working directory: $(pwd)"
echo "Contents of current directory:"
ls -la
echo "Contents of trajectories directory (if exists):"
ls -la trajectories/ 2>/dev/null || echo "trajectories directory not found"

# Run the main test with proper arguments
if [ -n "$REY30_APP_PATH" ] && [ -n "$PROCESS_NAME" ]; then
    python main.py --enable-reportportal --rp-token "$RP_TOKEN" --rey30-app-path "$REY30_APP_PATH" --rey30-process-name "$PROCESS_NAME"
elif [ -n "$REY30_APP_PATH" ]; then
    python main.py --enable-reportportal --rp-token "$RP_TOKEN" --rey30-app-path "$REY30_APP_PATH"
else
    python main.py --enable-reportportal --rp-token "$RP_TOKEN"
fi
