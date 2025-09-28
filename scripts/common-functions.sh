#!/bin/bash
# Common functions for IM Apps GitLab CI scripts
# Provides shared utilities for logging, error handling, and validation

set -euo pipefail

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $*" >&2
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*" >&2
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $*" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

# Error handling
die() {
    log_error "$*"
    exit 1
}

# Validation functions
validate_required_env() {
    local var_name="$1"
    local var_value="${!var_name:-}"

    if [[ -z "$var_value" ]]; then
        die "Required environment variable $var_name is not set"
    fi
}

validate_required_envs() {
    local required_vars=("$@")

    for var in "${required_vars[@]}"; do
        validate_required_env "$var"
    done
}

# File and directory utilities
ensure_directory() {
    local dir_path="$1"

    if [[ ! -d "$dir_path" ]]; then
        log_info "Creating directory: $dir_path"
        mkdir -p "$dir_path"
    fi
}

# Git utilities
git_config_ci_user() {
    log_info "Configuring Git user for CI"
    git config user.name "gitlab-ci[bot]"
    git config user.email "gitlab-ci@noreply.gitlab.com"
}

git_has_changes() {
    ! git diff --quiet HEAD
}

# Array parsing utilities
parse_comma_separated() {
    local input="$1"
    local -n output_array=$2

    if [[ -z "$input" ]]; then
        log_warning "Empty input provided to parse_comma_separated"
        return 1
    fi

    IFS=',' read -ra output_array <<< "$input"

    if [[ ${#output_array[@]} -eq 0 ]]; then
        log_warning "No items found after parsing comma-separated input: $input"
        return 1
    fi

    log_info "Parsed ${#output_array[@]} items from input"
    return 0
}

parse_colon_separated() {
    local input="$1"
    local -n output_array=$2

    IFS=':' read -ra output_array <<< "$input"

    if [[ ${#output_array[@]} -ne 2 ]]; then
        log_error "Expected exactly 2 colon-separated values, got ${#output_array[@]} from: $input"
        return 1
    fi

    return 0
}

# Template utilities
create_deployment_patch() {
    local project_name="$1"
    local app_name="$2"
    local environment="$3"
    local image_name="$4"
    local version="$5"
    local private_registry="$6"
    local output_file="$7"

    log_info "Creating deployment patch for $app_name in $environment environment"

    cat > "$output_file" << EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${project_name}-${app_name}
spec:
  template:
    spec:
      containers:
      - name: ${project_name}-${app_name}
        image: ${private_registry}/${image_name}:${version}
EOF

    log_success "Created deployment patch: $output_file"
}

# Validation for script execution
validate_script_environment() {
    local script_name="$1"
    shift
    local required_vars=("$@")

    log_info "Validating environment for script: $script_name"

    # Validate required environment variables
    validate_required_envs "${required_vars[@]}"

    log_success "Environment validation passed for $script_name"
}