#!/bin/bash
# GitOps Deployment Update Script
# Updates Kubernetes deployment manifests with new container images
# Used by GitLab CI to automate GitOps deployments

set -euo pipefail

# Get the directory of this script to source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common functions
# shellcheck source=./common-functions.sh
source "$SCRIPT_DIR/common-functions.sh"

# Required environment variables for this script
REQUIRED_VARS=(
    "PROJECT_NAME"
    "ENVIRONMENT"
    "VERSION"
    "PRIVATE_REGISTRY"
)

# Main function
main() {
    log_info "Starting GitOps deployment update"

    # Validate environment
    validate_script_environment "update-gitops-deployments.sh" "${REQUIRED_VARS[@]}"

    # Show current configuration
    log_info "Configuration:"
    log_info "  Project: $PROJECT_NAME"
    log_info "  Environment: $ENVIRONMENT"
    log_info "  Version: $VERSION"
    log_info "  Registry: $PRIVATE_REGISTRY"
    log_info "  APP_IMAGES: ${APP_IMAGES:-<not set>}"

    # Check if APP_IMAGES is provided
    if [[ -z "${APP_IMAGES:-}" ]]; then
        log_warning "APP_IMAGES environment variable is not set"
        log_info "Skipping image updates - no applications to update"
        return 0
    fi

    # Parse APP_IMAGES and update deployments
    update_deployments

    log_success "GitOps deployment update completed successfully"
}

# Update deployments based on APP_IMAGES variable
update_deployments() {
    log_info "Processing APP_IMAGES: $APP_IMAGES"

    # Parse comma-separated APP_IMAGES
    local images_array=()
    if ! parse_comma_separated "$APP_IMAGES" images_array; then
        die "Failed to parse APP_IMAGES: $APP_IMAGES"
    fi

    # Process each image
    for image_info in "${images_array[@]}"; do
        process_single_image "$image_info"
    done
}

# Process a single image update
process_single_image() {
    local image_info="$1"

    log_info "Processing image info: $image_info"

    # Parse colon-separated app:image pair
    local parts=()
    if ! parse_colon_separated "$image_info" parts; then
        die "Failed to parse image info: $image_info (expected format: app_name:image_name)"
    fi

    local app_name="${parts[0]}"
    local image_name="${parts[1]}"

    # Validate parsed values
    if [[ -z "$app_name" ]] || [[ -z "$image_name" ]]; then
        die "Invalid app_name or image_name parsed from: $image_info"
    fi

    log_info "Updating application '$app_name' to use image '$image_name:$VERSION'"

    # Create deployment patch
    create_deployment_patch_file "$app_name" "$image_name"
}

# Create deployment patch file for a specific application
create_deployment_patch_file() {
    local app_name="$1"
    local image_name="$2"

    # Construct patch file path
    local patch_file="apps/${PROJECT_NAME}/overlays/${ENVIRONMENT}/deployment-${app_name}-patch.yaml"

    log_info "Creating deployment patch at: $patch_file"

    # Ensure directory exists
    ensure_directory "$(dirname "$patch_file")"

    # Create the deployment patch using common function
    create_deployment_patch \
        "$PROJECT_NAME" \
        "$app_name" \
        "$ENVIRONMENT" \
        "$image_name" \
        "$VERSION" \
        "$PRIVATE_REGISTRY" \
        "$patch_file"

    # Verify the file was created
    if [[ ! -f "$patch_file" ]]; then
        die "Failed to create deployment patch file: $patch_file"
    fi

    log_success "Successfully updated deployment patch for $app_name"
}

# Error handling
trap 'log_error "Script failed at line $LINENO"' ERR

# Execute main function if script is run directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi