variable "region" {
  description = "Volcengine region, for example cn-beijing."
  type        = string
}

variable "zone_id" {
  description = "Availability zone that has inventory for the chosen instance type."
  type        = string
}

variable "image_id" {
  description = "A public Ubuntu 22.04/24.04 image ID in the selected region."
  type        = string
}

variable "instance_type" {
  description = "ECS instance type. 2 vCPU / 4 GiB or larger is recommended."
  type        = string
  default     = "ecs.g4i.large"
}

variable "key_pair_name" {
  description = "Existing ECS SSH key-pair name."
  type        = string
}

variable "project_name" {
  description = "Volcengine project."
  type        = string
  default     = "default"
}

variable "allowed_web_cidr" {
  description = "CIDR allowed to access the web UI. This must be an explicit, restricted network."
  type        = string
  validation {
    condition     = !contains(["0.0.0.0/0", "::/0"], var.allowed_web_cidr)
    error_message = "allowed_web_cidr must not expose this code-execution POC to the entire Internet."
  }
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to SSH to the ECS."
  type        = string
  validation {
    condition     = !contains(["0.0.0.0/0", "::/0"], var.allowed_ssh_cidr)
    error_message = "allowed_ssh_cidr must not expose SSH to the entire Internet."
  }
}

variable "repository_url" {
  description = "Public Git URL of this Starter Kit repository."
  type        = string
  validation {
    condition     = can(regex("^https://[^[:space:]@]+$", var.repository_url))
    error_message = "repository_url must be an HTTPS URL without credentials or whitespace."
  }
}

variable "repository_ref" {
  description = "Immutable 40-character Git commit SHA deployed by cloud-init."
  type        = string
  validation {
    condition     = can(regex("^[0-9a-fA-F]{40}$", var.repository_ref))
    error_message = "repository_ref must be a full 40-character Git commit SHA."
  }
}

variable "docker_install_script_sha256" {
  description = "Reviewed SHA-256 digest for https://get.docker.com at deployment time."
  type        = string
  validation {
    condition     = can(regex("^[0-9a-fA-F]{64}$", var.docker_install_script_sha256))
    error_message = "docker_install_script_sha256 must be a 64-character SHA-256 digest."
  }
}

variable "ark_api_key" {
  description = "Volcengine Ark API key. Supplied through TF_VAR_ark_api_key."
  type        = string
  sensitive   = true
}

variable "app_auth_token" {
  description = "Shared browser/API demo token. Supplied through TF_VAR_app_auth_token."
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.app_auth_token) >= 24 && length(var.app_auth_token) <= 128 && can(regex("^[A-Za-z0-9._~-]+$", var.app_auth_token)) && !startswith(var.app_auth_token, "replace-")
    error_message = "app_auth_token must contain 24-128 URL-safe, non-placeholder characters."
  }
}

variable "ark_model" {
  description = "Ark endpoint/model ID supporting the Responses API."
  type        = string
}

variable "ark_base_url" {
  description = "Ark OpenAI-compatible API base URL."
  type        = string
  default     = "https://ark.cn-beijing.volces.com/api/v3"
}
