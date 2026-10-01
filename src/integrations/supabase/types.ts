export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      abandoned_attachment_cleanup: {
        Row: {
          completed_at: string | null
          created_at: string
          expires_at: string | null
          grace_hours: number
          id: string
          object_created_at: string
          object_id: string
          state: string
          storage_path: string
          token: string
          upload_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          grace_hours: number
          id?: string
          object_created_at: string
          object_id: string
          state: string
          storage_path: string
          token: string
          upload_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          grace_hours?: number
          id?: string
          object_created_at?: string
          object_id?: string
          state?: string
          storage_path?: string
          token?: string
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "abandoned_attachment_cleanup_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "conversation_attachment_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      anesthesia_drug_administrations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          pet_id: string
          record_id: string
          request: NonNullable<Json>
        }
        Insert: {
          created_at?: string
          created_by: string
          id: string
          pet_id: string
          record_id: string
          request: NonNullable<Json>
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          pet_id?: string
          record_id?: string
          request?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "anesthesia_drug_administrations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anesthesia_drug_administrations_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "patient_treatments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anesthesia_drug_administrations_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anesthesia_drug_administrations_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "patient_anesthesia_records"
            referencedColumns: ["id"]
          },
        ]
      }
      anesthesia_record_addenda: {
        Row: {
          actor_id: string
          content: string
          id: string
          record_id: string
          recorded_at: string
        }
        Insert: {
          actor_id: string
          content: string
          id: string
          record_id: string
          recorded_at?: string
        }
        Update: {
          actor_id?: string
          content?: string
          id?: string
          record_id?: string
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anesthesia_record_addenda_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anesthesia_record_addenda_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "patient_anesthesia_records"
            referencedColumns: ["id"]
          },
        ]
      }
      anesthesia_record_revisions: {
        Row: {
          actor_id: string
          id: number
          record_id: string
          recorded_at: string
          snapshot: NonNullable<Json>
          version: number
        }
        Insert: {
          actor_id: string
          id?: never
          record_id: string
          recorded_at?: string
          snapshot: NonNullable<Json>
          version: number
        }
        Update: {
          actor_id?: string
          id?: never
          record_id?: string
          recorded_at?: string
          snapshot?: NonNullable<Json>
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "anesthesia_record_revisions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anesthesia_record_revisions_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "patient_anesthesia_records"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      appointment_reminders: {
        Row: {
          appointment_id: string
          appointment_version: number
          channel: string
          created_at: string
          enqueued_at: string | null
          error_message: string | null
          id: string
          outbound_delivery_id: string | null
          remind_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["reminder_status"]
          updated_at: string
        }
        Insert: {
          appointment_id: string
          appointment_version?: number
          channel?: string
          created_at?: string
          enqueued_at?: string | null
          error_message?: string | null
          id?: string
          outbound_delivery_id?: string | null
          remind_at: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          appointment_version?: number
          channel?: string
          created_at?: string
          enqueued_at?: string | null
          error_message?: string | null
          id?: string
          outbound_delivery_id?: string | null
          remind_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reminders_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reminders_outbound_delivery_id_fkey"
            columns: ["outbound_delivery_id"]
            isOneToOne: false
            referencedRelation: "outbound_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          address_snapshot: string
          appointment_type: string
          assigned_dvm_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          duration_minutes: number
          ezyvet_appointment_id: string | null
          id: string
          notes: string | null
          pet_id: string | null
          reminder_offsets: number[]
          resource_name: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          travel_after_minutes: number
          travel_before_minutes: number
          updated_at: string
          updated_by: string | null
          version: number
          visit_type: string
        }
        Insert: {
          address_snapshot?: string
          appointment_type: string
          assigned_dvm_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          duration_minutes?: number
          ezyvet_appointment_id?: string | null
          id?: string
          notes?: string | null
          pet_id?: string | null
          reminder_offsets?: number[]
          resource_name?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          travel_after_minutes?: number
          travel_before_minutes?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
          visit_type?: string
        }
        Update: {
          address_snapshot?: string
          appointment_type?: string
          assigned_dvm_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          duration_minutes?: number
          ezyvet_appointment_id?: string | null
          id?: string
          notes?: string | null
          pet_id?: string | null
          reminder_offsets?: number[]
          resource_name?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          travel_after_minutes?: number
          travel_before_minutes?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
          visit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_assigned_dvm_id_fkey"
            columns: ["assigned_dvm_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      billing_credits: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string
          id: string
          invoice_id: string
          reason: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by: string
          id: string
          invoice_id: string
          reason: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string
          id?: string
          invoice_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_credits_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_invoice_items: {
        Row: {
          amount_cents: number | null
          created_at: string
          created_by: string
          description: string
          id: string
          invoice_id: string
          pet_id: string | null
          product_id: string
          quantity: number
          unit_price_cents: number
        }
        Insert: {
          amount_cents?: never
          created_at?: string
          created_by: string
          description: string
          id: string
          invoice_id: string
          pet_id?: string | null
          product_id: string
          quantity: number
          unit_price_cents: number
        }
        Update: {
          amount_cents?: never
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          invoice_id?: string
          pet_id?: string | null
          product_id?: string
          quantity?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_invoice_items_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_invoices: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          currency: string
          id: string
          issued_at: string | null
          status: string
          total_cents: number | null
          version: number
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by: string
          currency?: string
          id: string
          issued_at?: string | null
          status?: string
          total_cents?: number | null
          version?: number
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          issued_at?: string | null
          status?: string
          total_cents?: number | null
          version?: number
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      call_logs: {
        Row: {
          call_sid: string
          call_type: Database["public"]["Enums"]["call_type"]
          completed_at: string | null
          created_at: string
          duration_seconds: number | null
          from_number: string
          id: string
          initiated_by: string | null
          status: string
          to_number: string
        }
        Insert: {
          call_sid: string
          call_type?: Database["public"]["Enums"]["call_type"]
          completed_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          from_number: string
          id?: string
          initiated_by?: string | null
          status?: string
          to_number: string
        }
        Update: {
          call_sid?: string
          call_type?: Database["public"]["Enums"]["call_type"]
          completed_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          from_number?: string
          id?: string
          initiated_by?: string | null
          status?: string
          to_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      callback_queue: {
        Row: {
          assigned_to_id: string | null
          attempted_at: string | null
          call_sid: string | null
          client_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          notes: string | null
          phone_number: string
          priority: number
          reason: string | null
          status: Database["public"]["Enums"]["callback_status"]
        }
        Insert: {
          assigned_to_id?: string | null
          attempted_at?: string | null
          call_sid?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          phone_number: string
          priority?: number
          reason?: string | null
          status?: Database["public"]["Enums"]["callback_status"]
        }
        Update: {
          assigned_to_id?: string | null
          attempted_at?: string | null
          call_sid?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          phone_number?: string
          priority?: number
          reason?: string | null
          status?: Database["public"]["Enums"]["callback_status"]
        }
        Relationships: [
          {
            foreignKeyName: "callback_queue_assigned_to_id_fkey"
            columns: ["assigned_to_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "callback_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_recipients: {
        Row: {
          campaign_id: string
          client_id: string
          error_message: string | null
          id: string
          sent_at: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          client_id: string
          error_message?: string | null
          id?: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          client_id?: string
          error_message?: string | null
          id?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          audience_filter: NonNullable<Json>
          channel: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          failed_count: number
          id: string
          message_content: string
          message_template_id: string | null
          name: string
          scheduled_at: string | null
          sent_count: number
          started_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          total_recipients: number
          updated_at: string
        }
        Insert: {
          audience_filter?: NonNullable<Json>
          channel?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          message_content: string
          message_template_id?: string | null
          name: string
          scheduled_at?: string | null
          sent_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          total_recipients?: number
          updated_at?: string
        }
        Update: {
          audience_filter?: NonNullable<Json>
          channel?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          message_content?: string
          message_template_id?: string | null
          name?: string
          scheduled_at?: string | null
          sent_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          total_recipients?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_message_template_id_fkey"
            columns: ["message_template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      care_message_templates: {
        Row: {
          active: boolean
          body: string
          channel: string
          days_before: number
          id: string
          name: string
          review_note: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          active?: boolean
          body: string
          channel: string
          days_before: number
          id: string
          name: string
          review_note: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          active?: boolean
          body?: string
          channel?: string
          days_before?: number
          id?: string
          name?: string
          review_note?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "care_message_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_revisions: {
        Row: {
          actor_id: string
          entity: string
          entity_id: string
          id: number
          recorded_at: string
          snapshot: NonNullable<Json>
          version: number
        }
        Insert: {
          actor_id: string
          entity: string
          entity_id: string
          id?: never
          recorded_at?: string
          snapshot: NonNullable<Json>
          version: number
        }
        Update: {
          actor_id?: string
          entity?: string
          entity_id?: string
          id?: never
          recorded_at?: string
          snapshot?: NonNullable<Json>
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_revisions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      care_reminder_jobs: {
        Row: {
          channel: string
          client_id: string
          created_at: string
          due_on: string
          id: string
          invalidated_at: string | null
          invalidation_reason: string | null
          message_template_id: string
          message_template_version: number
          pet_id: string
          rendered_body: string
          scheduled_on: string
          source_id: string
          source_kind: string
          source_snapshot: NonNullable<Json>
          source_version: number
          status: string
          template_snapshot: NonNullable<Json>
        }
        Insert: {
          channel: string
          client_id: string
          created_at?: string
          due_on: string
          id: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          message_template_id: string
          message_template_version: number
          pet_id: string
          rendered_body: string
          scheduled_on: string
          source_id: string
          source_kind: string
          source_snapshot: NonNullable<Json>
          source_version: number
          status?: string
          template_snapshot: NonNullable<Json>
        }
        Update: {
          channel?: string
          client_id?: string
          created_at?: string
          due_on?: string
          id?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          message_template_id?: string
          message_template_version?: number
          pet_id?: string
          rendered_body?: string
          scheduled_on?: string
          source_id?: string
          source_kind?: string
          source_snapshot?: NonNullable<Json>
          source_version?: number
          status?: string
          template_snapshot?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "care_reminder_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_reminder_jobs_message_template_id_fkey"
            columns: ["message_template_id"]
            isOneToOne: false
            referencedRelation: "care_message_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_reminder_jobs_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_products: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          id: string
          kind: string
          manufacturer: string
          name: string
          unit: string
          unit_price_cents: number
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          id?: string
          kind: string
          manufacturer?: string
          name: string
          unit: string
          unit_price_cents: number
          version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          manufacturer?: string
          name?: string
          unit?: string
          unit_price_cents?: number
          version?: number
        }
        Relationships: []
      }
      catalog_vaccine_profiles: {
        Row: {
          default_booster_interval_days: number | null
          group_key: string | null
          id: string
          labeled_duration: string | null
          product_id: string
          review_note: string
          species: string[]
          updated_at: string
          updated_by: string
          vaccine_type: string | null
          version: number
        }
        Insert: {
          default_booster_interval_days?: number | null
          group_key?: string | null
          id?: string
          labeled_duration?: string | null
          product_id: string
          review_note: string
          species?: string[]
          updated_at?: string
          updated_by: string
          vaccine_type?: string | null
          version?: number
        }
        Update: {
          default_booster_interval_days?: number | null
          group_key?: string | null
          id?: string
          labeled_duration?: string | null
          product_id?: string
          review_note?: string
          species?: string[]
          updated_at?: string
          updated_by?: string
          vaccine_type?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_vaccine_profiles_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_vaccine_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      certificate_issuers: {
        Row: {
          active: boolean
          clinical_acceptance_at: string
          full_name: string
          id: string
          license_expires_on: string
          license_number: string
          license_state: string
          practice_address: string
          practice_name: string
          practice_phone: string
          user_id: string
          verification_reference: string
          verified_at: string
        }
        Insert: {
          active?: boolean
          clinical_acceptance_at: string
          full_name: string
          id?: string
          license_expires_on: string
          license_number: string
          license_state: string
          practice_address: string
          practice_name: string
          practice_phone: string
          user_id: string
          verification_reference: string
          verified_at: string
        }
        Update: {
          active?: boolean
          clinical_acceptance_at?: string
          full_name?: string
          id?: string
          license_expires_on?: string
          license_number?: string
          license_state?: string
          practice_address?: string
          practice_name?: string
          practice_phone?: string
          user_id?: string
          verification_reference?: string
          verified_at?: string
        }
        Relationships: []
      }
      client_files: {
        Row: {
          category: Database["public"]["Enums"]["file_category"]
          client_id: string
          conversation_id: string | null
          created_at: string
          file_name: string
          file_path: string
          file_size: number
          id: string
          message_id: string | null
          mime_type: string | null
          uploaded_by: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["file_category"]
          client_id: string
          conversation_id?: string | null
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number
          id?: string
          message_id?: string | null
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["file_category"]
          client_id?: string
          conversation_id?: string | null
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number
          id?: string
          message_id?: string | null
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_files_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_files_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "client_files_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["latest_message_id"]
          },
          {
            foreignKeyName: "client_files_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          client_id: string
          content: string
          created_at: string
          created_by: string | null
          id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          ezyvet_id: string | null
          first_name: string
          full_name: string
          housecall_address: string | null
          id: string
          last_name: string
          mailing_address: string | null
          preferred_channel: Database["public"]["Enums"]["channel_type"] | null
          primary_email: string | null
          primary_phone: string | null
          version: number
        }
        Insert: {
          created_at?: string
          ezyvet_id?: string | null
          first_name: string
          full_name: string
          housecall_address?: string | null
          id?: string
          last_name: string
          mailing_address?: string | null
          preferred_channel?: Database["public"]["Enums"]["channel_type"] | null
          primary_email?: string | null
          primary_phone?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          ezyvet_id?: string | null
          first_name?: string
          full_name?: string
          housecall_address?: string | null
          id?: string
          last_name?: string
          mailing_address?: string | null
          preferred_channel?: Database["public"]["Enums"]["channel_type"] | null
          primary_email?: string | null
          primary_phone?: string | null
          version?: number
        }
        Relationships: []
      }
      clinical_addenda: {
        Row: {
          content: string
          created_at: string
          created_by: string
          encounter_id: string
          id: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by: string
          encounter_id: string
          id?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          encounter_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_addenda_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "clinical_encounters"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_encounters: {
        Row: {
          assessment: string
          created_at: string
          created_by: string
          id: string
          location: string
          objective: string
          pet_id: string
          plan: string
          signed_at: string | null
          signed_by: string | null
          status: string
          subjective: string
          updated_at: string
          updated_by: string
          version: number
          visit_at: string
          visit_type: string
        }
        Insert: {
          assessment?: string
          created_at?: string
          created_by: string
          id?: string
          location?: string
          objective?: string
          pet_id: string
          plan?: string
          signed_at?: string | null
          signed_by?: string | null
          status?: string
          subjective?: string
          updated_at?: string
          updated_by: string
          version?: number
          visit_at: string
          visit_type: string
        }
        Update: {
          assessment?: string
          created_at?: string
          created_by?: string
          id?: string
          location?: string
          objective?: string
          pet_id?: string
          plan?: string
          signed_at?: string | null
          signed_by?: string | null
          status?: string
          subjective?: string
          updated_at?: string
          updated_by?: string
          version?: number
          visit_at?: string
          visit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_encounters_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      cloudtalk_calls: {
        Row: {
          ai_language: string | null
          ai_summary: string | null
          call_id: string | null
          call_uuid: string
          direction: string | null
          duration_seconds: number | null
          ended_at: string | null
          external_number: string | null
          internal_number: string | null
          is_voicemail: boolean
          last_event_at: string
          recording_ready: boolean
          started_at: string | null
          talking_seconds: number | null
          transcript_ready: boolean
          trusted_number: boolean
        }
        Insert: {
          ai_language?: string | null
          ai_summary?: string | null
          call_id?: string | null
          call_uuid: string
          direction?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          external_number?: string | null
          internal_number?: string | null
          is_voicemail?: boolean
          last_event_at: string
          recording_ready?: boolean
          started_at?: string | null
          talking_seconds?: number | null
          transcript_ready?: boolean
          trusted_number?: boolean
        }
        Update: {
          ai_language?: string | null
          ai_summary?: string | null
          call_id?: string | null
          call_uuid?: string
          direction?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          external_number?: string | null
          internal_number?: string | null
          is_voicemail?: boolean
          last_event_at?: string
          recording_ready?: boolean
          started_at?: string | null
          talking_seconds?: number | null
          transcript_ready?: boolean
          trusted_number?: boolean
        }
        Relationships: []
      }
      cloudtalk_capability_redactions: {
        Row: {
          field: string
          id: number
          redacted_at: string
          redacted_by: string
          source: string
        }
        Insert: {
          field: string
          id?: never
          redacted_at?: string
          redacted_by?: string
          source: string
        }
        Update: {
          field?: string
          id?: never
          redacted_at?: string
          redacted_by?: string
          source?: string
        }
        Relationships: []
      }
      cloudtalk_events: {
        Row: {
          event_id: string
          event_type: string
          occurred_at: string
          received_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          occurred_at: string
          received_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          occurred_at?: string
          received_at?: string
        }
        Relationships: []
      }
      cloudtalk_messages: {
        Row: {
          body: string
          channel: string
          direction: string
          external_number: string
          internal_number: string
          message_id: string
          occurred_at: string
        }
        Insert: {
          body?: string
          channel: string
          direction: string
          external_number: string
          internal_number: string
          message_id: string
          occurred_at: string
        }
        Update: {
          body?: string
          channel?: string
          direction?: string
          external_number?: string
          internal_number?: string
          message_id?: string
          occurred_at?: string
        }
        Relationships: []
      }
      cloudtalk_projection_failures: {
        Row: {
          attempts: number
          first_failed_at: string
          last_failed_at: string
          resource_id: string
          sqlstate: string
        }
        Insert: {
          attempts?: number
          first_failed_at?: string
          last_failed_at?: string
          resource_id: string
          sqlstate: string
        }
        Update: {
          attempts?: number
          first_failed_at?: string
          last_failed_at?: string
          resource_id?: string
          sqlstate?: string
        }
        Relationships: []
      }
      communication_attempts: {
        Row: {
          attempt_number: number
          error_code: string | null
          finished_at: string | null
          id: string
          lease_token: string
          outbox_id: string
          outcome: string | null
          provider_message_id: string | null
          started_at: string
        }
        Insert: {
          attempt_number: number
          error_code?: string | null
          finished_at?: string | null
          id?: string
          lease_token: string
          outbox_id: string
          outcome?: string | null
          provider_message_id?: string | null
          started_at?: string
        }
        Update: {
          attempt_number?: number
          error_code?: string | null
          finished_at?: string | null
          id?: string
          lease_token?: string
          outbox_id?: string
          outcome?: string | null
          provider_message_id?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_attempts_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "communication_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_delivery_events: {
        Row: {
          event_id: string
          outbox_id: string
          outcome: string
          provider: string
          received_at: string
        }
        Insert: {
          event_id: string
          outbox_id: string
          outcome: string
          provider: string
          received_at?: string
        }
        Update: {
          event_id?: string
          outbox_id?: string
          outcome?: string
          provider?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_delivery_events_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "communication_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_event_retry_actions: {
        Row: {
          actor_id: string
          created_at: string
          cycle_no: number
          event_id: string
          expected_work_hash: string
          id: string
          lifetime_attempts: number
          previous_cycle_no: number
          reason: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          cycle_no: number
          event_id: string
          expected_work_hash: string
          id: string
          lifetime_attempts: number
          previous_cycle_no: number
          reason: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          cycle_no?: number
          event_id?: string
          expected_work_hash?: string
          id?: string
          lifetime_attempts?: number
          previous_cycle_no?: number
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_event_retry_actions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "communication_provider_events"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_inbound: {
        Row: {
          attachment_metadata: NonNullable<Json>
          body: string
          channel: string
          client_id: string | null
          conversation_id: string | null
          direction: string
          event_id: string | null
          html_body: string | null
          id: string
          message_id: string | null
          occurred_at: string
          provider: string
          received_at: string
          recipient: string
          reply_ids: string[]
          resource_id: string
          review_reason: string | null
          rfc_message_id: string | null
          sender: string
          subject: string
          version: number
        }
        Insert: {
          attachment_metadata?: NonNullable<Json>
          body: string
          channel: string
          client_id?: string | null
          conversation_id?: string | null
          direction?: string
          event_id?: string | null
          html_body?: string | null
          id?: string
          message_id?: string | null
          occurred_at: string
          provider: string
          received_at?: string
          recipient: string
          reply_ids?: string[]
          resource_id: string
          review_reason?: string | null
          rfc_message_id?: string | null
          sender: string
          subject?: string
          version?: number
        }
        Update: {
          attachment_metadata?: NonNullable<Json>
          body?: string
          channel?: string
          client_id?: string | null
          conversation_id?: string | null
          direction?: string
          event_id?: string | null
          html_body?: string | null
          id?: string
          message_id?: string | null
          occurred_at?: string
          provider?: string
          received_at?: string
          recipient?: string
          reply_ids?: string[]
          resource_id?: string
          review_reason?: string | null
          rfc_message_id?: string | null
          sender?: string
          subject?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "communication_inbound_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_inbound_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_inbound_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "communication_inbound_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "communication_provider_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_inbound_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["latest_message_id"]
          },
          {
            foreignKeyName: "communication_inbound_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_inbound_assignments: {
        Row: {
          assigned_by: string
          client_id: string
          conversation_id: string
          created_at: string
          id: string
          inbound_id: string
          reason: string
        }
        Insert: {
          assigned_by: string
          client_id: string
          conversation_id: string
          created_at?: string
          id?: string
          inbound_id: string
          reason: string
        }
        Update: {
          assigned_by?: string
          client_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          inbound_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_inbound_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_inbound_assignments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_inbound_assignments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "communication_inbound_assignments_inbound_id_fkey"
            columns: ["inbound_id"]
            isOneToOne: false
            referencedRelation: "communication_inbound"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_outbox: {
        Row: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          attachment_ids?: string[]
          attempt_count?: number
          attempt_started_at?: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at?: string
          created_by: string
          delivered_at?: string | null
          delivery_failure_kind?: string | null
          first_attempt_at?: string | null
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          message_id: string
          provider: string
          provider_config?: Json | null
          provider_message_id?: string | null
          recipient: string
          request_id: string
          revision?: number
          state?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          attachment_ids?: string[]
          attempt_count?: number
          attempt_started_at?: string | null
          body?: string
          channel?: string
          client_id?: string
          conversation_id?: string
          created_at?: string
          created_by?: string
          delivered_at?: string | null
          delivery_failure_kind?: string | null
          first_attempt_at?: string | null
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          message_id?: string
          provider?: string
          provider_config?: Json | null
          provider_message_id?: string | null
          recipient?: string
          request_id?: string
          revision?: number
          state?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_outbox_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_outbox_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_outbox_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "communication_outbox_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["latest_message_id"]
          },
          {
            foreignKeyName: "communication_outbox_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_phone_preferences: {
        Row: {
          event_id: string
          occurred_at: string
          opted_in: boolean
          phone: string
          resource_id: string
          updated_at: string
        }
        Insert: {
          event_id: string
          occurred_at: string
          opted_in: boolean
          phone: string
          resource_id: string
          updated_at?: string
        }
        Update: {
          event_id?: string
          occurred_at?: string
          opted_in?: boolean
          phone?: string
          resource_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_phone_preferences_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "communication_provider_events"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_prepared_requests: {
        Row: {
          actor_id: string
          created_at: string
          payload: Json | null
          request_id: string
          resolved_at: string | null
          scope: string
          state: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          payload?: Json | null
          request_id: string
          resolved_at?: string | null
          scope: string
          state: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          payload?: Json | null
          request_id?: string
          resolved_at?: string | null
          scope?: string
          state?: string
        }
        Relationships: []
      }
      communication_processing_history: {
        Row: {
          action: string
          attempts: number
          created_at: string
          cycle_attempts: number
          cycle_no: number
          event_id: string
          id: number
          last_error: string | null
          revision: number
          state: string
        }
        Insert: {
          action: string
          attempts: number
          created_at?: string
          cycle_attempts: number
          cycle_no: number
          event_id: string
          id?: never
          last_error?: string | null
          revision: number
          state: string
        }
        Update: {
          action?: string
          attempts?: number
          created_at?: string
          cycle_attempts?: number
          cycle_no?: number
          event_id?: string
          id?: never
          last_error?: string | null
          revision?: number
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_processing_history_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "communication_provider_events"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_provider_events: {
        Row: {
          attempts: number
          available_at: string
          cycle_attempts: number
          cycle_no: number
          event_id: string
          event_type: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          metadata: NonNullable<Json>
          payload_hash: string
          provider: string
          received_at: string
          resource_id: string
          revision: number
          state: string
          communication_processing_projection: Json | null
          communication_retry_eligible: boolean | null
          communication_retry_hash: string | null
        }
        Insert: {
          attempts?: number
          available_at?: string
          cycle_attempts?: number
          cycle_no?: number
          event_id: string
          event_type: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          metadata: NonNullable<Json>
          payload_hash: string
          provider: string
          received_at?: string
          resource_id: string
          revision?: number
          state?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          cycle_attempts?: number
          cycle_no?: number
          event_id?: string
          event_type?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          metadata?: NonNullable<Json>
          payload_hash?: string
          provider?: string
          received_at?: string
          resource_id?: string
          revision?: number
          state?: string
        }
        Relationships: []
      }
      communication_reconciliations: {
        Row: {
          created_at: string
          evidence_reference: string
          id: string
          outbox_id: string
          outcome: string
          previous_state: string
          provider_message_id: string | null
        }
        Insert: {
          created_at?: string
          evidence_reference: string
          id?: string
          outbox_id: string
          outcome: string
          previous_state: string
          provider_message_id?: string | null
        }
        Update: {
          created_at?: string
          evidence_reference?: string
          id?: string
          outbox_id?: string
          outcome?: string
          previous_state?: string
          provider_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_reconciliations_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "communication_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_retry_audit: {
        Row: {
          created_at: string
          id: string
          outbox_id: string
          previous_state: string
          requested_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          outbox_id: string
          previous_state: string
          requested_by: string
        }
        Update: {
          created_at?: string
          id?: string
          outbox_id?: string
          previous_state?: string
          requested_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_retry_audit_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "communication_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_sms_provider_setting: {
        Row: {
          provider: string
          singleton: boolean
          updated_at: string
        }
        Insert: {
          provider: string
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          provider?: string
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      communication_suppressions: {
        Row: {
          channel: string
          created_at: string
          created_by: string | null
          occurred_at: string | null
          provider: string | null
          provider_message_id: string | null
          reason: string
          recipient: string
        }
        Insert: {
          channel: string
          created_at?: string
          created_by?: string | null
          occurred_at?: string | null
          provider?: string | null
          provider_message_id?: string | null
          reason: string
          recipient: string
        }
        Update: {
          channel?: string
          created_at?: string
          created_by?: string | null
          occurred_at?: string | null
          provider?: string | null
          provider_message_id?: string | null
          reason?: string
          recipient?: string
        }
        Relationships: []
      }
      consent_form_templates: {
        Row: {
          content_html: string
          created_at: string
          form_schema: NonNullable<Json>
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          content_html?: string
          created_at?: string
          form_schema?: NonNullable<Json>
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          content_html?: string
          created_at?: string
          form_schema?: NonNullable<Json>
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      consent_submissions: {
        Row: {
          access_token: string
          client_id: string
          conversation_id: string | null
          created_at: string
          expires_at: string
          form_data: NonNullable<Json>
          id: string
          ip_address: string | null
          pet_id: string | null
          signature_data: string | null
          signed_at: string | null
          status: string
          template_id: string
          ticket_id: string | null
          user_agent: string | null
        }
        Insert: {
          access_token?: string
          client_id: string
          conversation_id?: string | null
          created_at?: string
          expires_at?: string
          form_data?: NonNullable<Json>
          id?: string
          ip_address?: string | null
          pet_id?: string | null
          signature_data?: string | null
          signed_at?: string | null
          status?: string
          template_id: string
          ticket_id?: string | null
          user_agent?: string | null
        }
        Update: {
          access_token?: string
          client_id?: string
          conversation_id?: string | null
          created_at?: string
          expires_at?: string
          form_data?: NonNullable<Json>
          id?: string
          ip_address?: string | null
          pet_id?: string | null
          signature_data?: string | null
          signed_at?: string | null
          status?: string
          template_id?: string
          ticket_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_submissions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_submissions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_submissions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "consent_submissions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_submissions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "consent_form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_submissions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_intake_budgets: {
        Row: {
          attempts: number
          bucket: string
          window_start: string
        }
        Insert: {
          attempts: number
          bucket: string
          window_start: string
        }
        Update: {
          attempts?: number
          bucket?: string
          window_start?: string
        }
        Relationships: []
      }
      contact_intake_requests: {
        Row: {
          capability_hash: string
          created_at: string
          payload: NonNullable<Json>
          request_id: string
          submission_id: string
        }
        Insert: {
          capability_hash: string
          created_at?: string
          payload: NonNullable<Json>
          request_id: string
          submission_id: string
        }
        Update: {
          capability_hash?: string
          created_at?: string
          payload?: NonNullable<Json>
          request_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_intake_requests_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "contact_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_submissions: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          contacted_at: string | null
          contacted_by: string | null
          created_at: string
          email: string
          id: string
          message: string
          name: string
          phone: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sms_consent: boolean
          sms_consent_at: string | null
          sms_consent_text: string | null
          staff_notes: string | null
          subject: string
          triage_status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          contacted_at?: string | null
          contacted_by?: string | null
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          phone?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sms_consent?: boolean
          sms_consent_at?: string | null
          sms_consent_text?: string | null
          staff_notes?: string | null
          subject: string
          triage_status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          contacted_at?: string | null
          contacted_by?: string | null
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          phone?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sms_consent?: boolean
          sms_consent_at?: string | null
          sms_consent_text?: string | null
          staff_notes?: string | null
          subject?: string
          triage_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversation_activity_audit: {
        Row: {
          action: string
          actor_id: string | null
          after_value: Json | null
          before_value: Json | null
          conversation_id: string
          created_at: string
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_value?: Json | null
          before_value?: Json | null
          conversation_id: string
          created_at?: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_value?: Json | null
          before_value?: Json | null
          conversation_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_activity_audit_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_activity_audit_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
        ]
      }
      conversation_attachment_uploads: {
        Row: {
          actor_id: string
          byte_length: number
          conversation_id: string
          created_at: string
          file_name: string
          id: string
          mime_type: string
          sha256: string | null
          status: string
          storage_path: string
          verified_at: string | null
        }
        Insert: {
          actor_id: string
          byte_length: number
          conversation_id: string
          created_at?: string
          file_name: string
          id: string
          mime_type: string
          sha256?: string | null
          status?: string
          storage_path: string
          verified_at?: string | null
        }
        Update: {
          actor_id?: string
          byte_length?: number
          conversation_id?: string
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          sha256?: string | null
          status?: string
          storage_path?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_attachment_uploads_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_attachment_uploads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_attachment_uploads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
        ]
      }
      conversation_email_artifacts: {
        Row: {
          captured_at: string | null
          created_at: string
          manifest: NonNullable<Json>
          payload_hash: string | null
          payload_text: string | null
          request_id: string
        }
        Insert: {
          captured_at?: string | null
          created_at?: string
          manifest: NonNullable<Json>
          payload_hash?: string | null
          payload_text?: string | null
          request_id: string
        }
        Update: {
          captured_at?: string | null
          created_at?: string
          manifest?: NonNullable<Json>
          payload_hash?: string | null
          payload_text?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_email_artifacts_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "communication_prepared_requests"
            referencedColumns: ["request_id"]
          },
        ]
      }
      conversation_email_outbox_links: {
        Row: {
          outbox_id: string
          queued_at: string
          queued_by: string
          request_id: string
          reviewed_payload_hash: string
        }
        Insert: {
          outbox_id: string
          queued_at?: string
          queued_by: string
          request_id: string
          reviewed_payload_hash: string
        }
        Update: {
          outbox_id?: string
          queued_at?: string
          queued_by?: string
          request_id?: string
          reviewed_payload_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_email_outbox_links_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: true
            referencedRelation: "communication_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_email_outbox_links_queued_by_fkey"
            columns: ["queued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_email_outbox_links_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "conversation_email_artifacts"
            referencedColumns: ["request_id"]
          },
        ]
      }
      conversation_read_cursors: {
        Row: {
          conversation_id: string
          message_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          message_id: string
          read_at: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          message_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_read_cursors_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_read_cursors_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "conversation_read_cursors_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["latest_message_id"]
          },
          {
            foreignKeyName: "conversation_read_cursors_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_unread_flags: {
        Row: {
          conversation_id: string
          forced: boolean
          revision: number
          user_id: string
        }
        Insert: {
          conversation_id: string
          forced?: boolean
          revision?: number
          user_id: string
        }
        Update: {
          conversation_id?: string
          forced?: boolean
          revision?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_unread_flags_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_unread_flags_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
        ]
      }
      conversations: {
        Row: {
          archived_at: string | null
          assigned_to_id: string | null
          client_id: string
          created_at: string
          first_message_at: string | null
          first_response_at: string | null
          id: string
          is_read: boolean
          last_message_at: string
          priority: Database["public"]["Enums"]["conversation_priority"]
          revision: number
          status: Database["public"]["Enums"]["conversation_status"]
          tags: string[]
        }
        Insert: {
          archived_at?: string | null
          assigned_to_id?: string | null
          client_id: string
          created_at?: string
          first_message_at?: string | null
          first_response_at?: string | null
          id?: string
          is_read?: boolean
          last_message_at?: string
          priority?: Database["public"]["Enums"]["conversation_priority"]
          revision?: number
          status?: Database["public"]["Enums"]["conversation_status"]
          tags?: string[]
        }
        Update: {
          archived_at?: string | null
          assigned_to_id?: string | null
          client_id?: string
          created_at?: string
          first_message_at?: string | null
          first_response_at?: string | null
          id?: string
          is_read?: boolean
          last_message_at?: string
          priority?: Database["public"]["Enums"]["conversation_priority"]
          revision?: number
          status?: Database["public"]["Enums"]["conversation_status"]
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_to_id_fkey"
            columns: ["assigned_to_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      dental_chart_addenda: {
        Row: {
          chart_id: string
          content: string
          created_at: string
          created_by: string
          id: string
        }
        Insert: {
          chart_id: string
          content: string
          created_at?: string
          created_by: string
          id: string
        }
        Update: {
          chart_id?: string
          content?: string
          created_at?: string
          created_by?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dental_chart_addenda_chart_id_fkey"
            columns: ["chart_id"]
            isOneToOne: false
            referencedRelation: "dental_charts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dental_chart_addenda_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dental_chart_revisions: {
        Row: {
          actor_id: string
          chart_id: string
          id: string
          notes: string
          recorded_at: string
          status: string
          teeth: NonNullable<Json>
          version: number
          visit_at: string
        }
        Insert: {
          actor_id: string
          chart_id: string
          id?: string
          notes: string
          recorded_at?: string
          status: string
          teeth: NonNullable<Json>
          version: number
          visit_at: string
        }
        Update: {
          actor_id?: string
          chart_id?: string
          id?: string
          notes?: string
          recorded_at?: string
          status?: string
          teeth?: NonNullable<Json>
          version?: number
          visit_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dental_chart_revisions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dental_chart_revisions_chart_id_fkey"
            columns: ["chart_id"]
            isOneToOne: false
            referencedRelation: "dental_charts"
            referencedColumns: ["id"]
          },
        ]
      }
      dental_charts: {
        Row: {
          created_at: string
          created_by: string
          dentition: string
          id: string
          notes: string
          pet_id: string
          signed_at: string | null
          signed_by: string | null
          species_family: string
          status: string
          teeth: NonNullable<Json>
          updated_at: string
          updated_by: string
          version: number
          visit_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          dentition: string
          id: string
          notes?: string
          pet_id: string
          signed_at?: string | null
          signed_by?: string | null
          species_family: string
          status?: string
          teeth?: NonNullable<Json>
          updated_at?: string
          updated_by: string
          version?: number
          visit_at: string
        }
        Update: {
          created_at?: string
          created_by?: string
          dentition?: string
          id?: string
          notes?: string
          pet_id?: string
          signed_at?: string | null
          signed_by?: string | null
          species_family?: string
          status?: string
          teeth?: NonNullable<Json>
          updated_at?: string
          updated_by?: string
          version?: number
          visit_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dental_charts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dental_charts_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dental_charts_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dental_charts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_link_access_budget: {
        Row: {
          grant_id: string
          used: number
        }
        Insert: {
          grant_id: string
          used?: number
        }
        Update: {
          grant_id?: string
          used?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_link_access_budget_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: true
            referencedRelation: "document_link_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_link_events: {
        Row: {
          actor_id: string
          artifact_hash: string | null
          created_at: string
          grant_id: string
          id: string
          kind: string
          message_hash: string | null
          reason: string | null
        }
        Insert: {
          actor_id: string
          artifact_hash?: string | null
          created_at?: string
          grant_id: string
          id?: string
          kind: string
          message_hash?: string | null
          reason?: string | null
        }
        Update: {
          actor_id?: string
          artifact_hash?: string | null
          created_at?: string
          grant_id?: string
          id?: string
          kind?: string
          message_hash?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_link_events_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "document_link_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_link_grants: {
        Row: {
          actor_id: string
          capability_context: string
          client_id: string
          conversation_id: string
          created_at: string
          expires_at: string
          family: string
          id: string
          key_version: string
          message_template: string
          origin: string
          recipient: string
          source_bundle: NonNullable<Json>
          source_hash: string
          source_id: string
          state: string
        }
        Insert: {
          actor_id: string
          capability_context: string
          client_id: string
          conversation_id: string
          created_at?: string
          expires_at: string
          family: string
          id: string
          key_version: string
          message_template: string
          origin: string
          recipient: string
          source_bundle: NonNullable<Json>
          source_hash: string
          source_id: string
          state?: string
        }
        Update: {
          actor_id?: string
          capability_context?: string
          client_id?: string
          conversation_id?: string
          created_at?: string
          expires_at?: string
          family?: string
          id?: string
          key_version?: string
          message_template?: string
          origin?: string
          recipient?: string
          source_bundle?: NonNullable<Json>
          source_hash?: string
          source_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_link_grants_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_link_grants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_link_grants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
        ]
      }
      document_link_outbox_links: {
        Row: {
          grant_id: string
          outbox_id: string
          queued_at: string
          queued_by: string
          reviewed_artifact_hash: string
          reviewed_message_hash: string
        }
        Insert: {
          grant_id: string
          outbox_id: string
          queued_at?: string
          queued_by: string
          reviewed_artifact_hash: string
          reviewed_message_hash: string
        }
        Update: {
          grant_id?: string
          outbox_id?: string
          queued_at?: string
          queued_by?: string
          reviewed_artifact_hash?: string
          reviewed_message_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_link_outbox_links_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: true
            referencedRelation: "document_link_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_link_outbox_links_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: true
            referencedRelation: "communication_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      document_link_payloads: {
        Row: {
          artifact_hash: string
          captured_at: string
          grant_id: string
          manifest: NonNullable<Json>
          message_hash: string
          payload_text: string
          token_hash: string
        }
        Insert: {
          artifact_hash: string
          captured_at?: string
          grant_id: string
          manifest: NonNullable<Json>
          message_hash: string
          payload_text: string
          token_hash: string
        }
        Update: {
          artifact_hash?: string
          captured_at?: string
          grant_id?: string
          manifest?: NonNullable<Json>
          message_hash?: string
          payload_text?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_link_payloads_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: true
            referencedRelation: "document_link_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      external_record_acknowledgments: {
        Row: {
          actor_id: string
          capture_hash: string
          created_at: string
          document_version: number
          id: string
          record_id: string
        }
        Insert: {
          actor_id: string
          capture_hash: string
          created_at?: string
          document_version: number
          id: string
          record_id: string
        }
        Update: {
          actor_id?: string
          capture_hash?: string
          created_at?: string
          document_version?: number
          id?: string
          record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_record_acknowledgments_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "external_record_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      external_record_byte_captures: {
        Row: {
          actor_id: string
          capture_hash: string
          captured_at: string
          content_sha256: string
          document_version: number
          file_size: number
          mime_type: string
          receipt_hash: string
          receipt_id: string
        }
        Insert: {
          actor_id: string
          capture_hash: string
          captured_at?: string
          content_sha256: string
          document_version: number
          file_size: number
          mime_type: string
          receipt_hash: string
          receipt_id: string
        }
        Update: {
          actor_id?: string
          capture_hash?: string
          captured_at?: string
          content_sha256?: string
          document_version?: number
          file_size?: number
          mime_type?: string
          receipt_hash?: string
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_record_byte_captures_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "external_record_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      external_record_receipts: {
        Row: {
          actor_id: string
          animal_link_id: string
          created_at: string
          document_id: string
          document_version: number
          entry_method: string
          export_reference: string
          file_size: number
          id: string
          mime_type: string
          pet_id: string
          pet_version: number
          previous_record_id: string | null
          receipt_hash: string
          received_at: string
          review_reason: string
          source_animal_id: string
          source_origin: string
          source_site_uid: string
        }
        Insert: {
          actor_id: string
          animal_link_id: string
          created_at?: string
          document_id: string
          document_version: number
          entry_method?: string
          export_reference: string
          file_size: number
          id: string
          mime_type: string
          pet_id: string
          pet_version: number
          previous_record_id?: string | null
          receipt_hash: string
          received_at: string
          review_reason: string
          source_animal_id: string
          source_origin: string
          source_site_uid: string
        }
        Update: {
          actor_id?: string
          animal_link_id?: string
          created_at?: string
          document_id?: string
          document_version?: number
          entry_method?: string
          export_reference?: string
          file_size?: number
          id?: string
          mime_type?: string
          pet_id?: string
          pet_version?: number
          previous_record_id?: string | null
          receipt_hash?: string
          received_at?: string
          review_reason?: string
          source_animal_id?: string
          source_origin?: string
          source_site_uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_record_receipts_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_record_receipts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "patient_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_record_receipts_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_record_receipts_previous_record_id_fkey"
            columns: ["previous_record_id"]
            isOneToOne: false
            referencedRelation: "external_record_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      external_record_versions: {
        Row: {
          actor_id: string
          animal_link_id: string
          capture_hash: string
          created_at: string
          document_id: string
          document_version: number
          export_reference: string
          id: string
          kind: string
          pet_id: string
          pet_version: number
          previous_record_id: string | null
          receipt_hash: string
          receipt_id: string
          review_reason: string
          version: number
        }
        Insert: {
          actor_id: string
          animal_link_id: string
          capture_hash: string
          created_at?: string
          document_id: string
          document_version: number
          export_reference: string
          id: string
          kind: string
          pet_id: string
          pet_version: number
          previous_record_id?: string | null
          receipt_hash: string
          receipt_id: string
          review_reason: string
          version: number
        }
        Update: {
          actor_id?: string
          animal_link_id?: string
          capture_hash?: string
          created_at?: string
          document_id?: string
          document_version?: number
          export_reference?: string
          id?: string
          kind?: string
          pet_id?: string
          pet_version?: number
          previous_record_id?: string | null
          receipt_hash?: string
          receipt_id?: string
          review_reason?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "external_record_versions_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_record_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "patient_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_record_versions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_record_versions_previous_record_id_fkey"
            columns: ["previous_record_id"]
            isOneToOne: false
            referencedRelation: "external_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_record_versions_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "external_record_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_attachment_approval_cancellations: {
        Row: {
          actor_id: string
          capture_hash: string
          created_at: string
          id: string
          pet_id: string
          request_id: string
        }
        Insert: {
          actor_id: string
          capture_hash: string
          created_at?: string
          id: string
          pet_id: string
          request_id: string
        }
        Update: {
          actor_id?: string
          capture_hash?: string
          created_at?: string
          id?: string
          pet_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_attachment_approval_cancellations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_approval_cancellations_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_approval_cancellations_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_attachment_original_captures"
            referencedColumns: ["request_id"]
          },
        ]
      }
      ezyvet_attachment_capture_attempts: {
        Row: {
          actor_id: string
          created_at: string
          lease_id: string
          lease_until: string
          request_id: string
        }
        Insert: {
          actor_id: string
          created_at: string
          lease_id: string
          lease_until: string
          request_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          lease_id?: string
          lease_until?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_attachment_capture_attempts_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_attachment_capture_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_attachment_capture_failures: {
        Row: {
          code: string
          created_at: string
          lease_id: string
          request_id: string
          retry_seconds: number
          terminal: boolean
        }
        Insert: {
          code: string
          created_at?: string
          lease_id: string
          request_id: string
          retry_seconds: number
          terminal: boolean
        }
        Update: {
          code?: string
          created_at?: string
          lease_id?: string
          request_id?: string
          retry_seconds?: number
          terminal?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_attachment_capture_failures_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_attachment_capture_attempts"
            referencedColumns: ["lease_id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_capture_failures_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_attachment_capture_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_attachment_capture_requests: {
        Row: {
          animal_link_id: string
          client_id: string
          created_at: string
          external_id: string
          file_id: string
          id: string
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          metadata: NonNullable<Json>
          observed_head_version: number
          ordinal: number
          page: number
          parent_context: NonNullable<Json>
          pet_id: string
          raw_record_sha256: string
          request_hash: string
          request_payload: NonNullable<Json>
          requested_by: string
          retry_after: string | null
          run_id: string
          snapshot_id: string
          stable_metadata_sha256: string
          status: string
          updated_at: string
        }
        Insert: {
          animal_link_id: string
          client_id: string
          created_at?: string
          external_id: string
          file_id: string
          id: string
          last_error_code?: string | null
          lease_id?: string | null
          lease_until?: string | null
          metadata: NonNullable<Json>
          observed_head_version: number
          ordinal: number
          page: number
          parent_context: NonNullable<Json>
          pet_id: string
          raw_record_sha256: string
          request_hash: string
          request_payload: NonNullable<Json>
          requested_by: string
          retry_after?: string | null
          run_id: string
          snapshot_id: string
          stable_metadata_sha256: string
          status?: string
          updated_at?: string
        }
        Update: {
          animal_link_id?: string
          client_id?: string
          created_at?: string
          external_id?: string
          file_id?: string
          id?: string
          last_error_code?: string | null
          lease_id?: string | null
          lease_until?: string | null
          metadata?: NonNullable<Json>
          observed_head_version?: number
          ordinal?: number
          page?: number
          parent_context?: NonNullable<Json>
          pet_id?: string
          raw_record_sha256?: string
          request_hash?: string
          request_payload?: NonNullable<Json>
          requested_by?: string
          retry_after?: string | null
          run_id?: string
          snapshot_id?: string
          stable_metadata_sha256?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_attachment_capture_requests_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_capture_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_capture_requests_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_capture_requests_run_id_page_ordinal_fkey"
            columns: ["run_id", "page", "ordinal"]
            isOneToOne: false
            referencedRelation: "ezyvet_attachment_page_observations"
            referencedColumns: ["run_id", "page", "ordinal"]
          },
          {
            foreignKeyName: "ezyvet_attachment_capture_requests_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_attachment_original_captures: {
        Row: {
          capture_hash: string
          captured_at: string
          content_sha256: string
          entry_method: string
          file_size: number
          id: string
          intent_id: string
          lease_id: string
          mime_type: string
          request_id: string
          storage_object_id: string
        }
        Insert: {
          capture_hash: string
          captured_at?: string
          content_sha256: string
          entry_method?: string
          file_size: number
          id?: string
          intent_id: string
          lease_id: string
          mime_type: string
          request_id: string
          storage_object_id: string
        }
        Update: {
          capture_hash?: string
          captured_at?: string
          content_sha256?: string
          entry_method?: string
          file_size?: number
          id?: string
          intent_id?: string
          lease_id?: string
          mime_type?: string
          request_id?: string
          storage_object_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_attachment_original_captures_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_attachment_original_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_original_captures_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_attachment_capture_attempts"
            referencedColumns: ["lease_id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_original_captures_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_attachment_capture_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_attachment_original_intents: {
        Row: {
          after_raw_sha256: string
          before_raw_sha256: string
          bucket_id: string
          content_sha256: string
          created_at: string
          file_size: number
          id: string
          mime_type: string
          object_path: string
          request_id: string
        }
        Insert: {
          after_raw_sha256: string
          before_raw_sha256: string
          bucket_id: string
          content_sha256: string
          created_at?: string
          file_size: number
          id?: string
          mime_type: string
          object_path: string
          request_id: string
        }
        Update: {
          after_raw_sha256?: string
          before_raw_sha256?: string
          bucket_id?: string
          content_sha256?: string
          created_at?: string
          file_size?: number
          id?: string
          mime_type?: string
          object_path?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_attachment_original_intents_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_attachment_capture_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_attachment_page_observations: {
        Row: {
          created_at: string
          external_id: string
          file_id: string
          head_version: number
          ordinal: number
          page: number
          raw_record_sha256: string
          run_id: string
          snapshot_id: string
          stable_metadata_sha256: string
        }
        Insert: {
          created_at?: string
          external_id: string
          file_id: string
          head_version: number
          ordinal: number
          page: number
          raw_record_sha256: string
          run_id: string
          snapshot_id: string
          stable_metadata_sha256: string
        }
        Update: {
          created_at?: string
          external_id?: string
          file_id?: string
          head_version?: number
          ordinal?: number
          page?: number
          raw_record_sha256?: string
          run_id?: string
          snapshot_id?: string
          stable_metadata_sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_attachment_page_observation_run_id_page_snapshot_id_fkey"
            columns: ["run_id", "page", "snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_page_items"
            referencedColumns: ["run_id", "page", "snapshot_id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_page_observations_run_id_page_fkey"
            columns: ["run_id", "page"]
            isOneToOne: false
            referencedRelation: "ezyvet_attachment_pages"
            referencedColumns: ["run_id", "page"]
          },
          {
            foreignKeyName: "ezyvet_attachment_page_observations_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_attachment_pages: {
        Row: {
          complete: boolean
          created_at: string
          observed_count: number
          page: number
          page_sha256: string
          pagination: NonNullable<Json>
          request_hash: string
          run_id: string
          staged_count: number
        }
        Insert: {
          complete: boolean
          created_at?: string
          observed_count: number
          page: number
          page_sha256: string
          pagination: NonNullable<Json>
          request_hash: string
          run_id: string
          staged_count: number
        }
        Update: {
          complete?: boolean
          created_at?: string
          observed_count?: number
          page?: number
          page_sha256?: string
          pagination?: NonNullable<Json>
          request_hash?: string
          run_id?: string
          staged_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_attachment_pages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_attachment_runs"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_pages_run_id_page_fkey"
            columns: ["run_id", "page"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_pages"
            referencedColumns: ["run_id", "page"]
          },
        ]
      }
      ezyvet_attachment_record_versions: {
        Row: {
          actor_id: string
          animal_link_id: string
          attachment_external_id: string
          capture_hash: string
          created_at: string
          entry_method: string
          id: string
          pet_id: string
          previous_record_id: string | null
          record_hash: string
          request_hash: string
          request_id: string
          review_reason: string
          source_context: NonNullable<Json>
          source_origin: string
          source_site_uid: string
          title: string
          version: number
        }
        Insert: {
          actor_id: string
          animal_link_id: string
          attachment_external_id: string
          capture_hash: string
          created_at?: string
          entry_method?: string
          id: string
          pet_id: string
          previous_record_id?: string | null
          record_hash: string
          request_hash: string
          request_id: string
          review_reason: string
          source_context: NonNullable<Json>
          source_origin: string
          source_site_uid: string
          title: string
          version: number
        }
        Update: {
          actor_id?: string
          animal_link_id?: string
          attachment_external_id?: string
          capture_hash?: string
          created_at?: string
          entry_method?: string
          id?: string
          pet_id?: string
          previous_record_id?: string | null
          record_hash?: string
          request_hash?: string
          request_id?: string
          review_reason?: string
          source_context?: NonNullable<Json>
          source_origin?: string
          source_site_uid?: string
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_attachment_record_versions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_record_versions_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_record_versions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_record_versions_previous_record_id_fkey"
            columns: ["previous_record_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_attachment_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_record_versions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_attachment_original_captures"
            referencedColumns: ["request_id"]
          },
        ]
      }
      ezyvet_attachment_runs: {
        Row: {
          actor_id: string
          animal_link_id: string
          created_at: string
          parent_context: NonNullable<Json>
          pet_id: string
          run_id: string
        }
        Insert: {
          actor_id: string
          animal_link_id: string
          created_at?: string
          parent_context: NonNullable<Json>
          pet_id: string
          run_id: string
        }
        Update: {
          actor_id?: string
          animal_link_id?: string
          created_at?: string
          parent_context?: NonNullable<Json>
          pet_id?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_attachment_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_runs_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_runs_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_attachment_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_clinical_page_observations: {
        Row: {
          head_version: number
          page: number
          run_id: string
          snapshot_id: string
        }
        Insert: {
          head_version: number
          page: number
          run_id: string
          snapshot_id: string
        }
        Update: {
          head_version?: number
          page?: number
          run_id?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_clinical_page_observations_run_id_page_fkey"
            columns: ["run_id", "page"]
            isOneToOne: false
            referencedRelation: "ezyvet_clinical_pages"
            referencedColumns: ["run_id", "page"]
          },
          {
            foreignKeyName: "ezyvet_clinical_page_observations_run_id_page_snapshot_id_fkey"
            columns: ["run_id", "page", "snapshot_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_page_items"
            referencedColumns: ["run_id", "page", "snapshot_id"]
          },
          {
            foreignKeyName: "ezyvet_clinical_page_observations_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_clinical_pages: {
        Row: {
          created_at: string
          page: number
          request_hash: string
          run_id: string
        }
        Insert: {
          created_at?: string
          page: number
          request_hash: string
          run_id: string
        }
        Update: {
          created_at?: string
          page?: number
          request_hash?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_clinical_pages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_clinical_runs"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "ezyvet_clinical_pages_run_id_page_fkey"
            columns: ["run_id", "page"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_pages"
            referencedColumns: ["run_id", "page"]
          },
        ]
      }
      ezyvet_clinical_runs: {
        Row: {
          actor_id: string
          animal_external_id: string
          animal_link_id: string
          client_id: string
          created_at: string
          pet_id: string
          resource: string
          run_id: string
          source_origin: string
          source_site_uid: string
        }
        Insert: {
          actor_id: string
          animal_external_id: string
          animal_link_id: string
          client_id: string
          created_at?: string
          pet_id: string
          resource: string
          run_id: string
          source_origin: string
          source_site_uid: string
        }
        Update: {
          actor_id?: string
          animal_external_id?: string
          animal_link_id?: string
          client_id?: string
          created_at?: string
          pet_id?: string
          resource?: string
          run_id?: string
          source_origin?: string
          source_site_uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_clinical_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_clinical_runs_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_clinical_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_clinical_runs_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_clinical_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_history_discrepancy_reviews: {
        Row: {
          extraction_id: string
          id: string
          pet_id: string
          reviewed_at: string
          reviewed_by: string
          reviewed_sources: NonNullable<Json>
        }
        Insert: {
          extraction_id: string
          id: string
          pet_id: string
          reviewed_at?: string
          reviewed_by: string
          reviewed_sources: NonNullable<Json>
        }
        Update: {
          extraction_id?: string
          id?: string
          pet_id?: string
          reviewed_at?: string
          reviewed_by?: string
          reviewed_sources?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_history_discrepancy_reviews_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_problem_extractions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_history_discrepancy_reviews_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "ezyvet_history_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_history_discrepancy_reviews_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_history_discrepancy_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_history_requests: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          kind: string
          payload: Json | null
          pet_id: string
          request_hash: string | null
          resolved_at: string | null
          review_context: Json | null
          status: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          id: string
          kind: string
          payload?: Json | null
          pet_id: string
          request_hash?: string | null
          resolved_at?: string | null
          review_context?: Json | null
          status: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          kind?: string
          payload?: Json | null
          pet_id?: string
          request_hash?: string | null
          resolved_at?: string | null
          review_context?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_history_requests_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_history_requests_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_identity_heads: {
        Row: {
          external_id: string
          observed_at: string
          resource: string
          snapshot_id: string
          source_origin: string
          source_site_uid: string
          version: number
        }
        Insert: {
          external_id: string
          observed_at?: string
          resource: string
          snapshot_id: string
          source_origin: string
          source_site_uid: string
          version?: number
        }
        Update: {
          external_id?: string
          observed_at?: string
          resource?: string
          snapshot_id?: string
          source_origin?: string
          source_site_uid?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_identity_heads_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_import_page_items: {
        Row: {
          page: number
          run_id: string
          snapshot_id: string
        }
        Insert: {
          page: number
          run_id: string
          snapshot_id: string
        }
        Update: {
          page?: number
          run_id?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_import_page_items_run_id_page_fkey"
            columns: ["run_id", "page"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_pages"
            referencedColumns: ["run_id", "page"]
          },
          {
            foreignKeyName: "ezyvet_import_page_items_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_import_pages: {
        Row: {
          fetched_at: string
          item_count: number
          page: number
          run_id: string
        }
        Insert: {
          fetched_at?: string
          item_count: number
          page: number
          run_id: string
        }
        Update: {
          fetched_at?: string
          item_count?: number
          page?: number
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_import_pages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_import_reviews: {
        Row: {
          client_id: string | null
          created_at: string
          decision: string
          id: string
          pet_id: string | null
          reason: string
          reviewed_by: string
          snapshot_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          decision: string
          id?: string
          pet_id?: string | null
          reason: string
          reviewed_by: string
          snapshot_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          decision?: string
          id?: string
          pet_id?: string | null
          reason?: string
          reviewed_by?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_import_reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_import_reviews_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_import_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_import_reviews_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_import_runs: {
        Row: {
          created_at: string
          id: string
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          next_page: number
          requested_by: string
          resource: string
          retry_after: string | null
          source_origin: string
          source_site_uid: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          last_error_code?: string | null
          lease_id?: string | null
          lease_until?: string | null
          next_page?: number
          requested_by: string
          resource: string
          retry_after?: string | null
          source_origin: string
          source_site_uid: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_error_code?: string | null
          lease_id?: string | null
          lease_until?: string | null
          next_page?: number
          requested_by?: string
          resource?: string
          retry_after?: string | null
          source_origin?: string
          source_site_uid?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_import_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_import_snapshots: {
        Row: {
          created_at: string
          external_id: string
          first_seen_by: string
          id: string
          payload: NonNullable<Json>
          payload_hash: string
          resource: string
          source_origin: string
          source_site_uid: string
        }
        Insert: {
          created_at?: string
          external_id: string
          first_seen_by: string
          id?: string
          payload: NonNullable<Json>
          payload_hash: string
          resource: string
          source_origin: string
          source_site_uid: string
        }
        Update: {
          created_at?: string
          external_id?: string
          first_seen_by?: string
          id?: string
          payload?: NonNullable<Json>
          payload_hash?: string
          resource?: string
          source_origin?: string
          source_site_uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_import_snapshots_first_seen_by_fkey"
            columns: ["first_seen_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_imported_histories: {
        Row: {
          animal_external_id: string
          animal_link_id: string
          approved_at: string
          approved_by: string
          consult: NonNullable<Json>
          history_external_id: string
          id: string
          observed_head_version: number
          original: NonNullable<Json>
          payload_hash: string
          pet_id: string
          snapshot_id: string
          source_origin: string
          source_site_uid: string
          version: number
          version_hash: string
        }
        Insert: {
          animal_external_id: string
          animal_link_id: string
          approved_at?: string
          approved_by: string
          consult: NonNullable<Json>
          history_external_id: string
          id: string
          observed_head_version: number
          original: NonNullable<Json>
          payload_hash: string
          pet_id: string
          snapshot_id: string
          source_origin: string
          source_site_uid: string
          version: number
          version_hash: string
        }
        Update: {
          animal_external_id?: string
          animal_link_id?: string
          approved_at?: string
          approved_by?: string
          consult?: NonNullable<Json>
          history_external_id?: string
          id?: string
          observed_head_version?: number
          original?: NonNullable<Json>
          payload_hash?: string
          pet_id?: string
          snapshot_id?: string
          source_origin?: string
          source_site_uid?: string
          version?: number
          version_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_imported_histories_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_histories_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_histories_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "ezyvet_history_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_histories_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_histories_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_imported_prescription_items: {
        Row: {
          evidence: NonNullable<Json>
          ordinal: number
          prescription_id: string
          snapshot_id: string
        }
        Insert: {
          evidence: NonNullable<Json>
          ordinal: number
          prescription_id: string
          snapshot_id: string
        }
        Update: {
          evidence?: NonNullable<Json>
          ordinal?: number
          prescription_id?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_imported_prescription_items_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_imported_prescriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_prescription_items_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_imported_prescriptions: {
        Row: {
          animal_link_id: string
          approved_at: string
          approved_by: string
          client_id: string
          context: NonNullable<Json>
          expected_predecessor_hash: string | null
          id: string
          interpretation_hash: string
          pet_id: string
          prescription_external_id: string
          reason: string
          replaces_id: string | null
          source_origin: string
          source_site_uid: string
          version: number
          version_hash: string
        }
        Insert: {
          animal_link_id: string
          approved_at?: string
          approved_by: string
          client_id: string
          context: NonNullable<Json>
          expected_predecessor_hash?: string | null
          id: string
          interpretation_hash: string
          pet_id: string
          prescription_external_id: string
          reason: string
          replaces_id?: string | null
          source_origin: string
          source_site_uid: string
          version: number
          version_hash: string
        }
        Update: {
          animal_link_id?: string
          approved_at?: string
          approved_by?: string
          client_id?: string
          context?: NonNullable<Json>
          expected_predecessor_hash?: string | null
          id?: string
          interpretation_hash?: string
          pet_id?: string
          prescription_external_id?: string
          reason?: string
          replaces_id?: string | null
          source_origin?: string
          source_site_uid?: string
          version?: number
          version_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_imported_prescriptions_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_prescriptions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_prescriptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_prescriptions_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "ezyvet_prescription_review_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_prescriptions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_prescriptions_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_imported_prescriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_imported_vaccinations: {
        Row: {
          animal_external_id: string
          animal_link_id: string
          approved_at: string
          approved_by: string
          client_id: string
          consult: NonNullable<Json>
          expected_predecessor_hash: string | null
          id: string
          interpretation_hash: string
          observed_head_version: number
          original: NonNullable<Json>
          payload_hash: string
          pet_id: string
          product: Json | null
          reason: string
          replaces_id: string | null
          reviewed: NonNullable<Json>
          snapshot_id: string
          source_origin: string
          source_site_uid: string
          vaccination_external_id: string
          version: number
          version_hash: string
        }
        Insert: {
          animal_external_id: string
          animal_link_id: string
          approved_at?: string
          approved_by: string
          client_id: string
          consult: NonNullable<Json>
          expected_predecessor_hash?: string | null
          id: string
          interpretation_hash: string
          observed_head_version: number
          original: NonNullable<Json>
          payload_hash: string
          pet_id: string
          product?: Json | null
          reason: string
          replaces_id?: string | null
          reviewed: NonNullable<Json>
          snapshot_id: string
          source_origin: string
          source_site_uid: string
          vaccination_external_id: string
          version: number
          version_hash: string
        }
        Update: {
          animal_external_id?: string
          animal_link_id?: string
          approved_at?: string
          approved_by?: string
          client_id?: string
          consult?: NonNullable<Json>
          expected_predecessor_hash?: string | null
          id?: string
          interpretation_hash?: string
          observed_head_version?: number
          original?: NonNullable<Json>
          payload_hash?: string
          pet_id?: string
          product?: Json | null
          reason?: string
          replaces_id?: string | null
          reviewed?: NonNullable<Json>
          snapshot_id?: string
          source_origin?: string
          source_site_uid?: string
          vaccination_external_id?: string
          version?: number
          version_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_imported_vaccinations_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_vaccinations_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_vaccinations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_vaccinations_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "ezyvet_vaccination_review_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_vaccinations_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_vaccinations_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_imported_vaccinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_imported_vaccinations_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_migration_attempt_events: {
        Row: {
          actor_id: string
          attempt_hash: string | null
          child_run_id: string
          error_code: string | null
          event_key: string
          history_origin: string | null
          id: string
          kind: string
          next_page: number
          page: number
          recorded_at: string
          retry_after: string | null
          run_status: string
          sequence: number
          staged_item_count: number | null
        }
        Insert: {
          actor_id: string
          attempt_hash?: string | null
          child_run_id: string
          error_code?: string | null
          event_key: string
          history_origin?: string | null
          id?: string
          kind: string
          next_page: number
          page: number
          recorded_at?: string
          retry_after?: string | null
          run_status: string
          sequence: number
          staged_item_count?: number | null
        }
        Update: {
          actor_id?: string
          attempt_hash?: string | null
          child_run_id?: string
          error_code?: string | null
          event_key?: string
          history_origin?: string | null
          id?: string
          kind?: string
          next_page?: number
          page?: number
          recorded_at?: string
          retry_after?: string | null
          run_status?: string
          sequence?: number
          staged_item_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_migration_attempt_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_migration_attempt_events_child_run_id_fkey"
            columns: ["child_run_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_migration_bindings: {
        Row: {
          actor_id: string
          child_context: NonNullable<Json>
          child_run_id: string
          context_hash: string
          created_at: string
          id: string
          reason: string
          replaces_id: string | null
          scope_id: string
        }
        Insert: {
          actor_id: string
          child_context: NonNullable<Json>
          child_run_id: string
          context_hash: string
          created_at?: string
          id: string
          reason: string
          replaces_id?: string | null
          scope_id: string
        }
        Update: {
          actor_id?: string
          child_context?: NonNullable<Json>
          child_run_id?: string
          context_hash?: string
          created_at?: string
          id?: string
          reason?: string
          replaces_id?: string | null
          scope_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_migration_bindings_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_migration_bindings_child_run_id_fkey"
            columns: ["child_run_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_migration_bindings_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_migration_bindings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_migration_bindings_scope_id_fkey"
            columns: ["scope_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_migration_scopes"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_migration_resolutions: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          migration_run_id: string
          reason: string
          record_hash: string
          replaces_id: string | null
          request_hash: string
          reviewed_context: NonNullable<Json>
          reviewed_context_hash: string
          scope_id: string
          target: NonNullable<Json>
          target_key: string
          target_kind: string
          version: number
          ezyvet_migration_resolution_receipt: Json | null
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id: string
          migration_run_id: string
          reason: string
          record_hash: string
          replaces_id?: string | null
          request_hash: string
          reviewed_context: NonNullable<Json>
          reviewed_context_hash: string
          scope_id: string
          target: NonNullable<Json>
          target_key: string
          target_kind: string
          version: number
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          migration_run_id?: string
          reason?: string
          record_hash?: string
          replaces_id?: string | null
          request_hash?: string
          reviewed_context?: NonNullable<Json>
          reviewed_context_hash?: string
          scope_id?: string
          target?: NonNullable<Json>
          target_key?: string
          target_kind?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_migration_resolutions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_migration_resolutions_migration_run_id_fkey"
            columns: ["migration_run_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_migration_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_migration_resolutions_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_migration_resolutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_migration_resolutions_scope_id_fkey"
            columns: ["scope_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_migration_scopes"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_migration_runs: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          intent: NonNullable<Json>
          intent_hash: string
          source_origin: string
          source_site_uid: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          id: string
          intent: NonNullable<Json>
          intent_hash: string
          source_origin: string
          source_site_uid: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          intent?: NonNullable<Json>
          intent_hash?: string
          source_origin?: string
          source_site_uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_migration_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_migration_scopes: {
        Row: {
          client_id: string
          disposition: string
          id: string
          mapping_head_version: number
          mapping_id: string
          mapping_snapshot_id: string
          migration_run_id: string
          parent_external_id: string
          parent_head_version: number
          parent_payload_hash: string
          parent_snapshot_id: string
          parent_type: string
          pet_id: string | null
          reason: string
          resource: string
        }
        Insert: {
          client_id: string
          disposition: string
          id: string
          mapping_head_version: number
          mapping_id: string
          mapping_snapshot_id: string
          migration_run_id: string
          parent_external_id: string
          parent_head_version: number
          parent_payload_hash: string
          parent_snapshot_id: string
          parent_type: string
          pet_id?: string | null
          reason: string
          resource: string
        }
        Update: {
          client_id?: string
          disposition?: string
          id?: string
          mapping_head_version?: number
          mapping_id?: string
          mapping_snapshot_id?: string
          migration_run_id?: string
          parent_external_id?: string
          parent_head_version?: number
          parent_payload_hash?: string
          parent_snapshot_id?: string
          parent_type?: string
          pet_id?: string | null
          reason?: string
          resource?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_migration_scopes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_migration_scopes_mapping_id_fkey"
            columns: ["mapping_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_migration_scopes_mapping_snapshot_id_fkey"
            columns: ["mapping_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_migration_scopes_migration_run_id_fkey"
            columns: ["migration_run_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_migration_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_migration_scopes_parent_snapshot_id_fkey"
            columns: ["parent_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_migration_scopes_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_prescription_page_observations: {
        Row: {
          head_version: number
          page: number
          run_id: string
          snapshot_id: string
        }
        Insert: {
          head_version: number
          page: number
          run_id: string
          snapshot_id: string
        }
        Update: {
          head_version?: number
          page?: number
          run_id?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_prescription_page_observati_run_id_page_snapshot_id_fkey"
            columns: ["run_id", "page", "snapshot_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_page_items"
            referencedColumns: ["run_id", "page", "snapshot_id"]
          },
          {
            foreignKeyName: "ezyvet_prescription_page_observations_run_id_page_fkey"
            columns: ["run_id", "page"]
            isOneToOne: false
            referencedRelation: "ezyvet_prescription_pages"
            referencedColumns: ["run_id", "page"]
          },
          {
            foreignKeyName: "ezyvet_prescription_page_observations_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_prescription_pages: {
        Row: {
          created_at: string
          page: number
          request_hash: string
          run_id: string
        }
        Insert: {
          created_at?: string
          page: number
          request_hash: string
          run_id: string
        }
        Update: {
          created_at?: string
          page?: number
          request_hash?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_prescription_pages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_prescription_runs"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "ezyvet_prescription_pages_run_id_page_fkey"
            columns: ["run_id", "page"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_pages"
            referencedColumns: ["run_id", "page"]
          },
        ]
      }
      ezyvet_prescription_review_requests: {
        Row: {
          actor_id: string
          approved_record_id: string | null
          created_at: string
          id: string
          payload: Json | null
          pet_id: string
          request_hash: string | null
          resolved_at: string | null
          review_context: Json | null
          status: string
        }
        Insert: {
          actor_id: string
          approved_record_id?: string | null
          created_at?: string
          id: string
          payload?: Json | null
          pet_id: string
          request_hash?: string | null
          resolved_at?: string | null
          review_context?: Json | null
          status: string
        }
        Update: {
          actor_id?: string
          approved_record_id?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          pet_id?: string
          request_hash?: string | null
          resolved_at?: string | null
          review_context?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_prescription_review_requests_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_prescription_review_requests_approved_record_id_fkey"
            columns: ["approved_record_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_imported_prescriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_prescription_review_requests_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_prescription_runs: {
        Row: {
          actor_id: string
          animal_external_id: string
          animal_link_id: string
          client_id: string
          created_at: string
          pet_id: string
          resource: string
          run_id: string
          source_origin: string
          source_site_uid: string
        }
        Insert: {
          actor_id: string
          animal_external_id: string
          animal_link_id: string
          client_id: string
          created_at?: string
          pet_id: string
          resource: string
          run_id: string
          source_origin: string
          source_site_uid: string
        }
        Update: {
          actor_id?: string
          animal_external_id?: string
          animal_link_id?: string
          client_id?: string
          created_at?: string
          pet_id?: string
          resource?: string
          run_id?: string
          source_origin?: string
          source_site_uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_prescription_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_prescription_runs_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_prescription_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_prescription_runs_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_prescription_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_prescriptionitem_page_observations: {
        Row: {
          head_version: number
          page: number
          run_id: string
          snapshot_id: string
        }
        Insert: {
          head_version: number
          page: number
          run_id: string
          snapshot_id: string
        }
        Update: {
          head_version?: number
          page?: number
          run_id?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_prescriptionitem_page_obser_run_id_page_snapshot_id_fkey"
            columns: ["run_id", "page", "snapshot_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_page_items"
            referencedColumns: ["run_id", "page", "snapshot_id"]
          },
          {
            foreignKeyName: "ezyvet_prescriptionitem_page_observations_run_id_page_fkey"
            columns: ["run_id", "page"]
            isOneToOne: false
            referencedRelation: "ezyvet_prescriptionitem_pages"
            referencedColumns: ["run_id", "page"]
          },
          {
            foreignKeyName: "ezyvet_prescriptionitem_page_observations_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_prescriptionitem_pages: {
        Row: {
          created_at: string
          page: number
          request_hash: string
          run_id: string
        }
        Insert: {
          created_at?: string
          page: number
          request_hash: string
          run_id: string
        }
        Update: {
          created_at?: string
          page?: number
          request_hash?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_prescriptionitem_pages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_prescriptionitem_runs"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "ezyvet_prescriptionitem_pages_run_id_page_fkey"
            columns: ["run_id", "page"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_pages"
            referencedColumns: ["run_id", "page"]
          },
        ]
      }
      ezyvet_prescriptionitem_runs: {
        Row: {
          actor_id: string
          animal_external_id: string
          animal_link_id: string
          client_id: string
          created_at: string
          pet_id: string
          prescription_external_id: string
          prescription_observed_head_version: number
          prescription_payload_hash: string
          prescription_snapshot_id: string
          resource: string
          run_id: string
          source_origin: string
          source_site_uid: string
        }
        Insert: {
          actor_id: string
          animal_external_id: string
          animal_link_id: string
          client_id: string
          created_at?: string
          pet_id: string
          prescription_external_id: string
          prescription_observed_head_version: number
          prescription_payload_hash: string
          prescription_snapshot_id: string
          resource: string
          run_id: string
          source_origin: string
          source_site_uid: string
        }
        Update: {
          actor_id?: string
          animal_external_id?: string
          animal_link_id?: string
          client_id?: string
          created_at?: string
          pet_id?: string
          prescription_external_id?: string
          prescription_observed_head_version?: number
          prescription_payload_hash?: string
          prescription_snapshot_id?: string
          resource?: string
          run_id?: string
          source_origin?: string
          source_site_uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_prescriptionitem_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_prescriptionitem_runs_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_prescriptionitem_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_prescriptionitem_runs_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_prescriptionitem_runs_prescription_snapshot_id_fkey"
            columns: ["prescription_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_prescriptionitem_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_problem_extractions: {
        Row: {
          action: string
          extracted_at: string
          extracted_by: string
          id: string
          pet_id: string
          problem_fields: NonNullable<Json>
          problem_id: string
          problem_version: number
        }
        Insert: {
          action: string
          extracted_at?: string
          extracted_by: string
          id: string
          pet_id: string
          problem_fields: NonNullable<Json>
          problem_id: string
          problem_version: number
        }
        Update: {
          action?: string
          extracted_at?: string
          extracted_by?: string
          id?: string
          pet_id?: string
          problem_fields?: NonNullable<Json>
          problem_id?: string
          problem_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_problem_extractions_extracted_by_fkey"
            columns: ["extracted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_problem_extractions_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "ezyvet_history_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_problem_extractions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_problem_extractions_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "patient_problems"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_problem_history_sources: {
        Row: {
          extraction_id: string
          history_id: string
          version_hash: string
        }
        Insert: {
          extraction_id: string
          history_id: string
          version_hash: string
        }
        Update: {
          extraction_id?: string
          history_id?: string
          version_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_problem_history_sources_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_problem_extractions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_problem_history_sources_history_id_fkey"
            columns: ["history_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_imported_histories"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_record_links: {
        Row: {
          action: string
          approved_by: string
          client_id: string | null
          created_at: string
          external_id: string
          head_version: number
          id: string
          local_version: number
          pet_id: string | null
          reason: string
          request_hash: string
          request_id: string
          resource: string
          snapshot_id: string
          source_origin: string
          source_site_uid: string
        }
        Insert: {
          action: string
          approved_by: string
          client_id?: string | null
          created_at?: string
          external_id: string
          head_version: number
          id?: string
          local_version: number
          pet_id?: string | null
          reason: string
          request_hash: string
          request_id: string
          resource: string
          snapshot_id: string
          source_origin: string
          source_site_uid: string
        }
        Update: {
          action?: string
          approved_by?: string
          client_id?: string | null
          created_at?: string
          external_id?: string
          head_version?: number
          id?: string
          local_version?: number
          pet_id?: string | null
          reason?: string
          request_hash?: string
          request_id?: string
          resource?: string
          snapshot_id?: string
          source_origin?: string
          source_site_uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_record_links_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_record_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_record_links_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_record_links_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_vaccination_page_observations: {
        Row: {
          head_version: number
          page: number
          run_id: string
          snapshot_id: string
        }
        Insert: {
          head_version: number
          page: number
          run_id: string
          snapshot_id: string
        }
        Update: {
          head_version?: number
          page?: number
          run_id?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_vaccination_page_observatio_run_id_page_snapshot_id_fkey"
            columns: ["run_id", "page", "snapshot_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_page_items"
            referencedColumns: ["run_id", "page", "snapshot_id"]
          },
          {
            foreignKeyName: "ezyvet_vaccination_page_observations_run_id_page_fkey"
            columns: ["run_id", "page"]
            isOneToOne: false
            referencedRelation: "ezyvet_vaccination_pages"
            referencedColumns: ["run_id", "page"]
          },
          {
            foreignKeyName: "ezyvet_vaccination_page_observations_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_vaccination_pages: {
        Row: {
          created_at: string
          page: number
          request_hash: string
          run_id: string
        }
        Insert: {
          created_at?: string
          page: number
          request_hash: string
          run_id: string
        }
        Update: {
          created_at?: string
          page?: number
          request_hash?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_vaccination_pages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_vaccination_runs"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "ezyvet_vaccination_pages_run_id_page_fkey"
            columns: ["run_id", "page"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_pages"
            referencedColumns: ["run_id", "page"]
          },
        ]
      }
      ezyvet_vaccination_review_requests: {
        Row: {
          actor_id: string
          approved_record_id: string | null
          created_at: string
          id: string
          payload: Json | null
          pet_id: string
          request_hash: string | null
          resolved_at: string | null
          review_context: Json | null
          status: string
        }
        Insert: {
          actor_id: string
          approved_record_id?: string | null
          created_at?: string
          id: string
          payload?: Json | null
          pet_id: string
          request_hash?: string | null
          resolved_at?: string | null
          review_context?: Json | null
          status: string
        }
        Update: {
          actor_id?: string
          approved_record_id?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          pet_id?: string
          request_hash?: string | null
          resolved_at?: string | null
          review_context?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_vaccination_review_requests_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_vaccination_review_requests_approved_record_id_fkey"
            columns: ["approved_record_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_imported_vaccinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_vaccination_review_requests_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_vaccination_runs: {
        Row: {
          actor_id: string
          animal_external_id: string
          animal_link_id: string
          client_id: string
          consult_external_id: string
          consult_observed_head_version: number
          consult_payload_hash: string
          consult_snapshot_id: string
          created_at: string
          pet_id: string
          resource: string
          run_id: string
          source_origin: string
          source_site_uid: string
        }
        Insert: {
          actor_id: string
          animal_external_id: string
          animal_link_id: string
          client_id: string
          consult_external_id: string
          consult_observed_head_version: number
          consult_payload_hash: string
          consult_snapshot_id: string
          created_at?: string
          pet_id: string
          resource: string
          run_id: string
          source_origin: string
          source_site_uid: string
        }
        Update: {
          actor_id?: string
          animal_external_id?: string
          animal_link_id?: string
          client_id?: string
          consult_external_id?: string
          consult_observed_head_version?: number
          consult_payload_hash?: string
          consult_snapshot_id?: string
          created_at?: string
          pet_id?: string
          resource?: string
          run_id?: string
          source_origin?: string
          source_site_uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_vaccination_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_vaccination_runs_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_vaccination_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_vaccination_runs_consult_snapshot_id_fkey"
            columns: ["consult_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_vaccination_runs_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_vaccination_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_weight_approvals: {
        Row: {
          action: string
          animal_link_id: string
          approved_by: string
          created_at: string
          external_id: string
          head_version: number
          patient_version: number
          pet_id: string
          reason: string
          request_hash: string
          request_id: string
          reviewed_values: NonNullable<Json>
          snapshot_id: string
          source_origin: string
          source_site_uid: string
          weight_id: string
        }
        Insert: {
          action: string
          animal_link_id: string
          approved_by: string
          created_at?: string
          external_id: string
          head_version: number
          patient_version: number
          pet_id: string
          reason: string
          request_hash: string
          request_id: string
          reviewed_values: NonNullable<Json>
          snapshot_id: string
          source_origin: string
          source_site_uid: string
          weight_id: string
        }
        Update: {
          action?: string
          animal_link_id?: string
          approved_by?: string
          created_at?: string
          external_id?: string
          head_version?: number
          patient_version?: number
          pet_id?: string
          reason?: string
          request_hash?: string
          request_id?: string
          reviewed_values?: NonNullable<Json>
          snapshot_id?: string
          source_origin?: string
          source_site_uid?: string
          weight_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_weight_approvals_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_weight_approvals_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_weight_approvals_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_weight_approvals_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_weight_approvals_weight_id_fkey"
            columns: ["weight_id"]
            isOneToOne: false
            referencedRelation: "patient_weights"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_weight_requests: {
        Row: {
          actor_id: string
          created_at: string
          payload: Json | null
          request_id: string
          snapshot_id: string
          status: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          payload?: Json | null
          request_id: string
          snapshot_id: string
          status: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          payload?: Json | null
          request_id?: string
          snapshot_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_weight_requests_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_weight_requests_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_weight_runs: {
        Row: {
          animal_link_id: string
          created_at: string
          run_id: string
        }
        Insert: {
          animal_link_id: string
          created_at?: string
          run_id: string
        }
        Update: {
          animal_link_id?: string
          created_at?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_weight_runs_animal_link_id_fkey"
            columns: ["animal_link_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_record_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_weight_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "ezyvet_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ezyvet_weight_source_reviews: {
        Row: {
          approval_id: string
          created_at: string
          head_version: number
          reason: string
          request_id: string
          reviewed_by: string
          snapshot_id: string
        }
        Insert: {
          approval_id: string
          created_at?: string
          head_version: number
          reason: string
          request_id: string
          reviewed_by: string
          snapshot_id: string
        }
        Update: {
          approval_id?: string
          created_at?: string
          head_version?: number
          reason?: string
          request_id?: string
          reviewed_by?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ezyvet_weight_source_reviews_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_weight_approvals"
            referencedColumns: ["request_id"]
          },
          {
            foreignKeyName: "ezyvet_weight_source_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ezyvet_weight_source_reviews_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ezyvet_import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_instances: {
        Row: {
          client_id: string
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          current_step: number
          id: string
          pet_id: string | null
          started_at: string
          status: string
          template_id: string
          ticket_id: string | null
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          current_step?: number
          id?: string
          pet_id?: string | null
          started_at?: string
          status?: string
          template_id: string
          ticket_id?: string | null
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          current_step?: number
          id?: string
          pet_id?: string | null
          started_at?: string
          status?: string
          template_id?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_instances_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_instances_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_instances_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "follow_up_instances_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_instances_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "follow_up_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_instances_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_messages: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          instance_id: string
          scheduled_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["follow_up_status"]
          step_index: number
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          instance_id: string
          scheduled_at: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["follow_up_status"]
          step_index: number
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          instance_id?: string
          scheduled_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["follow_up_status"]
          step_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "follow_up_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_templates: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          steps: NonNullable<Json>
          trigger_ticket_types: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          steps?: NonNullable<Json>
          trigger_ticket_types?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          steps?: NonNullable<Json>
          trigger_ticket_types?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      inbound_attachment_captures: {
        Row: {
          actor_id: string
          attachment_id: string
          captured_at: string | null
          created_at: string
          email_id: string
          id: string
          inbound_id: string
          inbound_version: number
          lease_expires_at: string | null
          lease_token: string
          message_id: string
          metadata: NonNullable<Json>
          sha256: string | null
          status: string
          storage_path: string
          inbound_capture_receipt: Json | null
        }
        Insert: {
          actor_id: string
          attachment_id: string
          captured_at?: string | null
          created_at?: string
          email_id: string
          id?: string
          inbound_id: string
          inbound_version: number
          lease_expires_at?: string | null
          lease_token: string
          message_id: string
          metadata: NonNullable<Json>
          sha256?: string | null
          status: string
          storage_path: string
        }
        Update: {
          actor_id?: string
          attachment_id?: string
          captured_at?: string | null
          created_at?: string
          email_id?: string
          id?: string
          inbound_id?: string
          inbound_version?: number
          lease_expires_at?: string | null
          lease_token?: string
          message_id?: string
          metadata?: NonNullable<Json>
          sha256?: string | null
          status?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_attachment_captures_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_attachment_captures_inbound_id_fkey"
            columns: ["inbound_id"]
            isOneToOne: false
            referencedRelation: "communication_inbound"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_attachment_captures_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["latest_message_id"]
          },
          {
            foreignKeyName: "inbound_attachment_captures_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_read_snapshots: {
        Row: {
          applied_at: string | null
          boundaries: NonNullable<Json>
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          boundaries: NonNullable<Json>
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          applied_at?: string | null
          boundaries?: NonNullable<Json>
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      inventory_lots: {
        Row: {
          created_at: string
          created_by: string
          expires_on: string
          id: string
          location: string
          lot_number: string
          product_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_on: string
          id: string
          location: string
          lot_number: string
          product_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_on?: string
          id?: string
          location?: string
          lot_number?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          created_by: string
          id: string
          kind: string
          lot_id: string
          quantity: number
          reason: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id: string
          kind: string
          lot_id: string
          quantity: number
          reason: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          lot_id?: string
          quantity?: number
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_checkout_attempts: {
        Row: {
          account_id: string
          actor_id: string
          amount_cents: number
          cancel_url: string
          client_id: string
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          invoice_id: string
          livemode: boolean
          retry_before: string
          return_context_version: number
          return_key_version: string | null
          return_origin: string | null
          return_scope_id: string | null
          session_expires_at: string
          source_hash: string
          success_url: string
        }
        Insert: {
          account_id: string
          actor_id: string
          amount_cents: number
          cancel_url: string
          client_id: string
          created_at?: string
          currency?: string
          id: string
          idempotency_key: string
          invoice_id: string
          livemode: boolean
          retry_before?: string
          return_context_version?: number
          return_key_version?: string | null
          return_origin?: string | null
          return_scope_id?: string | null
          session_expires_at?: string
          source_hash: string
          success_url: string
        }
        Update: {
          account_id?: string
          actor_id?: string
          amount_cents?: number
          cancel_url?: string
          client_id?: string
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string
          invoice_id?: string
          livemode?: boolean
          retry_before?: string
          return_context_version?: number
          return_key_version?: string | null
          return_origin?: string | null
          return_scope_id?: string | null
          session_expires_at?: string
          source_hash?: string
          success_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_checkout_attempts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_checkout_attempts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_checkout_attempts_return_scope_id_fkey"
            columns: ["return_scope_id"]
            isOneToOne: false
            referencedRelation: "payment_collection_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_email_outbox_links: {
        Row: {
          outbox_id: string
          queued_at: string
          queued_by: string
          request_id: string
          reviewed_payload_hash: string
        }
        Insert: {
          outbox_id: string
          queued_at?: string
          queued_by: string
          request_id: string
          reviewed_payload_hash: string
        }
        Update: {
          outbox_id?: string
          queued_at?: string
          queued_by?: string
          request_id?: string
          reviewed_payload_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_email_outbox_links_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: true
            referencedRelation: "communication_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_email_outbox_links_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "invoice_email_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_email_payloads: {
        Row: {
          captured_at: string
          manifest: NonNullable<Json>
          payload_hash: string
          payload_text: string | null
          purged_at: string | null
          request_id: string
        }
        Insert: {
          captured_at?: string
          manifest: NonNullable<Json>
          payload_hash: string
          payload_text?: string | null
          purged_at?: string | null
          request_id: string
        }
        Update: {
          captured_at?: string
          manifest?: NonNullable<Json>
          payload_hash?: string
          payload_text?: string | null
          purged_at?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_email_payloads_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "invoice_email_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_email_requests: {
        Row: {
          actor_id: string
          body: string
          client_id: string
          conversation_id: string
          created_at: string
          id: string
          invoice_hash: string
          invoice_id: string
          invoice_snapshot: NonNullable<Json>
          recipient: string
          state: string
          subject: string
        }
        Insert: {
          actor_id: string
          body: string
          client_id: string
          conversation_id: string
          created_at?: string
          id: string
          invoice_hash: string
          invoice_id: string
          invoice_snapshot: NonNullable<Json>
          recipient: string
          state?: string
          subject: string
        }
        Update: {
          actor_id?: string
          body?: string
          client_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          invoice_hash?: string
          invoice_id?: string
          invoice_snapshot?: NonNullable<Json>
          recipient?: string
          state?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_email_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_email_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_email_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "invoice_email_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payment_evidence: {
        Row: {
          account_id: string
          amount_cents: number | null
          created_at: string
          currency: string | null
          disposition: string
          event_id: string
          id: string
          kind: string
          livemode: boolean
          payment_id: string | null
          reason: string
          request_id: string
          session_id: string | null
          source_hash: string | null
        }
        Insert: {
          account_id: string
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          disposition: string
          event_id: string
          id?: string
          kind: string
          livemode: boolean
          payment_id?: string | null
          reason: string
          request_id: string
          session_id?: string | null
          source_hash?: string | null
        }
        Update: {
          account_id?: string
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          disposition?: string
          event_id?: string
          id?: string
          kind?: string
          livemode?: boolean
          payment_id?: string | null
          reason?: string
          request_id?: string
          session_id?: string | null
          source_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payment_evidence_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "invoice_checkout_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          account_id: string
          amount_cents: number
          created_at: string
          currency: string
          evidence_id: string
          id: string
          invoice_id: string
          livemode: boolean
          payment_id: string
          request_id: string
        }
        Insert: {
          account_id: string
          amount_cents: number
          created_at?: string
          currency: string
          evidence_id: string
          id?: string
          invoice_id: string
          livemode: boolean
          payment_id: string
          request_id: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          created_at?: string
          currency?: string
          evidence_id?: string
          id?: string
          invoice_id?: string
          livemode?: boolean
          payment_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: true
            referencedRelation: "invoice_payment_evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "invoice_checkout_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_refund_evidence: {
        Row: {
          account_id: string
          amount_cents: number
          created_at: string
          currency: string
          disposition: string
          event_id: string
          id: string
          livemode: boolean
          provider_payment_id: string
          reason: string
          refund_id: string
          request_id: string
          status: string
        }
        Insert: {
          account_id: string
          amount_cents: number
          created_at?: string
          currency: string
          disposition: string
          event_id: string
          id?: string
          livemode: boolean
          provider_payment_id: string
          reason: string
          refund_id: string
          request_id: string
          status: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          created_at?: string
          currency?: string
          disposition?: string
          event_id?: string
          id?: string
          livemode?: boolean
          provider_payment_id?: string
          reason?: string
          refund_id?: string
          request_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_refund_evidence_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "invoice_refund_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_refund_requests: {
        Row: {
          actor_id: string
          amount_cents: number
          created_at: string
          id: string
          idempotency_key: string
          invoice_id: string
          payment_id: string
          reason: string
          retry_before: string
        }
        Insert: {
          actor_id: string
          amount_cents: number
          created_at?: string
          id: string
          idempotency_key: string
          invoice_id: string
          payment_id: string
          reason: string
          retry_before?: string
        }
        Update: {
          actor_id?: string
          amount_cents?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          invoice_id?: string
          payment_id?: string
          reason?: string
          retry_before?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_refund_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_refund_requests_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "invoice_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_refunds: {
        Row: {
          account_id: string
          amount_cents: number
          created_at: string
          evidence_id: string
          id: string
          invoice_id: string
          livemode: boolean
          payment_id: string
          refund_id: string
          request_id: string
        }
        Insert: {
          account_id: string
          amount_cents: number
          created_at?: string
          evidence_id: string
          id?: string
          invoice_id: string
          livemode: boolean
          payment_id: string
          refund_id: string
          request_id: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          created_at?: string
          evidence_id?: string
          id?: string
          invoice_id?: string
          livemode?: boolean
          payment_id?: string
          refund_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_refunds_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: true
            referencedRelation: "invoice_refund_evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_refunds_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "invoice_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_refunds_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "invoice_refund_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_due_templates: {
        Row: {
          active: boolean
          id: string
          interval_days: number
          name: string
          review_note: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          active?: boolean
          id: string
          interval_days: number
          name: string
          review_note: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          active?: boolean
          id?: string
          interval_days?: number
          name?: string
          review_note?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "lab_due_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_order_source_reviews: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          order_id: string
          order_version: number
          pet_id: string
          previous_review_id: string | null
          review_reason: string
          revision: number
          source_account_id: string
          source_order_reference: string
          source_patient_reference: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          id: string
          order_id: string
          order_version: number
          pet_id: string
          previous_review_id?: string | null
          review_reason: string
          revision: number
          source_account_id: string
          source_order_reference: string
          source_patient_reference: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          order_id?: string
          order_version?: number
          pet_id?: string
          previous_review_id?: string | null
          review_reason?: string
          revision?: number
          source_account_id?: string
          source_order_reference?: string
          source_patient_reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_order_source_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "patient_lab_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_order_source_reviews_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_order_source_reviews_previous_review_id_fkey"
            columns: ["previous_review_id"]
            isOneToOne: false
            referencedRelation: "lab_order_source_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_order_source_reviews_source_account_id_fkey"
            columns: ["source_account_id"]
            isOneToOne: false
            referencedRelation: "lab_source_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_report_acknowledgments: {
        Row: {
          actor_id: string
          capture_hash: string
          created_at: string
          document_version: number
          id: string
          report_id: string
        }
        Insert: {
          actor_id: string
          capture_hash: string
          created_at?: string
          document_version: number
          id: string
          report_id: string
        }
        Update: {
          actor_id?: string
          capture_hash?: string
          created_at?: string
          document_version?: number
          id?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_report_acknowledgments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "lab_report_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_report_byte_captures: {
        Row: {
          actor_id: string
          capture_hash: string
          captured_at: string
          content_sha256: string
          document_version: number
          file_size: number
          mime_type: string
          receipt_hash: string
          receipt_id: string
        }
        Insert: {
          actor_id: string
          capture_hash: string
          captured_at?: string
          content_sha256: string
          document_version: number
          file_size: number
          mime_type: string
          receipt_hash: string
          receipt_id: string
        }
        Update: {
          actor_id?: string
          capture_hash?: string
          captured_at?: string
          content_sha256?: string
          document_version?: number
          file_size?: number
          mime_type?: string
          receipt_hash?: string
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_report_byte_captures_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "lab_report_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_report_receipts: {
        Row: {
          actor_id: string
          created_at: string
          document_id: string
          document_version: number
          entry_method: string
          file_size: number
          id: string
          mime_type: string
          pet_id: string
          receipt_hash: string
          received_at: string
          source_account_id: string
          source_order_reference: string
          source_patient_reference: string
          source_report_reference: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          document_id: string
          document_version: number
          entry_method?: string
          file_size: number
          id: string
          mime_type: string
          pet_id: string
          receipt_hash: string
          received_at: string
          source_account_id: string
          source_order_reference: string
          source_patient_reference: string
          source_report_reference: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          document_id?: string
          document_version?: number
          entry_method?: string
          file_size?: number
          id?: string
          mime_type?: string
          pet_id?: string
          receipt_hash?: string
          received_at?: string
          source_account_id?: string
          source_order_reference?: string
          source_patient_reference?: string
          source_report_reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_report_receipts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "patient_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_report_receipts_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_report_receipts_source_account_id_fkey"
            columns: ["source_account_id"]
            isOneToOne: false
            referencedRelation: "lab_source_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_report_versions: {
        Row: {
          actor_id: string
          capture_hash: string
          created_at: string
          document_id: string
          document_version: number
          id: string
          kind: string
          order_id: string
          order_version: number
          pet_id: string
          previous_report_id: string | null
          receipt_hash: string
          receipt_id: string
          review_reason: string
          source_review_id: string
          version: number
        }
        Insert: {
          actor_id: string
          capture_hash: string
          created_at?: string
          document_id: string
          document_version: number
          id: string
          kind: string
          order_id: string
          order_version: number
          pet_id: string
          previous_report_id?: string | null
          receipt_hash: string
          receipt_id: string
          review_reason: string
          source_review_id: string
          version: number
        }
        Update: {
          actor_id?: string
          capture_hash?: string
          created_at?: string
          document_id?: string
          document_version?: number
          id?: string
          kind?: string
          order_id?: string
          order_version?: number
          pet_id?: string
          previous_report_id?: string | null
          receipt_hash?: string
          receipt_id?: string
          review_reason?: string
          source_review_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "lab_report_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "patient_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_report_versions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "patient_lab_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_report_versions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_report_versions_previous_report_id_fkey"
            columns: ["previous_report_id"]
            isOneToOne: false
            referencedRelation: "lab_report_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_report_versions_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "lab_report_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_report_versions_source_review_id_fkey"
            columns: ["source_review_id"]
            isOneToOne: false
            referencedRelation: "lab_order_source_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_results: {
        Row: {
          client_id: string
          conversation_id: string | null
          created_at: string
          external_order_id: string | null
          id: string
          lab_provider: string
          pdf_storage_path: string | null
          pet_id: string | null
          result_data: NonNullable<Json>
          result_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          client_id: string
          conversation_id?: string | null
          created_at?: string
          external_order_id?: string | null
          id?: string
          lab_provider: string
          pdf_storage_path?: string | null
          pet_id?: string | null
          result_data?: NonNullable<Json>
          result_type: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          client_id?: string
          conversation_id?: string | null
          created_at?: string
          external_order_id?: string | null
          id?: string
          lab_provider?: string
          pdf_storage_path?: string | null
          pet_id?: string | null
          result_data?: NonNullable<Json>
          result_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_results_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_results_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_results_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "lab_results_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_results_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_source_accounts: {
        Row: {
          account_reference: string
          actor_id: string
          created_at: string
          environment_label: string
          id: string
          manual_import_enabled: boolean
          provider_label: string
          review_note: string
          transport_enabled: boolean
        }
        Insert: {
          account_reference: string
          actor_id: string
          created_at?: string
          environment_label: string
          id: string
          manual_import_enabled?: boolean
          provider_label: string
          review_note: string
          transport_enabled?: boolean
        }
        Update: {
          account_reference?: string
          actor_id?: string
          created_at?: string
          environment_label?: string
          id?: string
          manual_import_enabled?: boolean
          provider_label?: string
          review_note?: string
          transport_enabled?: boolean
        }
        Relationships: []
      }
      lab_work_revisions: {
        Row: {
          actor_id: string
          entity: string
          entity_id: string
          id: number
          reason: string
          recorded_at: string
          snapshot: NonNullable<Json>
          version: number
        }
        Insert: {
          actor_id: string
          entity: string
          entity_id: string
          id?: never
          reason: string
          recorded_at?: string
          snapshot: NonNullable<Json>
          version: number
        }
        Update: {
          actor_id?: string
          entity?: string
          entity_id?: string
          id?: never
          reason?: string
          recorded_at?: string
          snapshot?: NonNullable<Json>
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "lab_work_revisions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_size: number
          file_type: string
          id: string
          message_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size: number
          file_type: string
          id?: string
          message_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number
          file_type?: string
          id?: string
          message_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["latest_message_id"]
          },
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          category: string
          channel: string
          content: string
          created_at: string
          created_by: string | null
          id: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          channel?: string
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          channel?: string
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          audio_url: string | null
          content: string | null
          conversation_id: string
          created_at: string
          id: string
          is_internal: boolean
          ivr_path: string | null
          provider: string | null
          provider_message_id: string | null
          sender_id: string | null
          sender_type: Database["public"]["Enums"]["sender_type"]
          transcription: string | null
          triage_confidence: number | null
          triage_priority: string | null
          triage_reason: string | null
          type: Database["public"]["Enums"]["message_type"]
        }
        Insert: {
          audio_url?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          is_internal?: boolean
          ivr_path?: string | null
          provider?: string | null
          provider_message_id?: string | null
          sender_id?: string | null
          sender_type: Database["public"]["Enums"]["sender_type"]
          transcription?: string | null
          triage_confidence?: number | null
          triage_priority?: string | null
          triage_reason?: string | null
          type: Database["public"]["Enums"]["message_type"]
        }
        Update: {
          audio_url?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          ivr_path?: string | null
          provider?: string | null
          provider_message_id?: string | null
          sender_id?: string | null
          sender_type?: Database["public"]["Enums"]["sender_type"]
          transcription?: string | null
          triage_confidence?: number | null
          triage_priority?: string | null
          triage_reason?: string | null
          type?: Database["public"]["Enums"]["message_type"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_dispense_allocations: {
        Row: {
          dispense_id: string
          id: string
          lot_id: string
          movement_id: string
          quantity: number
        }
        Insert: {
          dispense_id: string
          id: string
          lot_id: string
          movement_id: string
          quantity: number
        }
        Update: {
          dispense_id?: string
          id?: string
          lot_id?: string
          movement_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_dispense_allocations_dispense_id_fkey"
            columns: ["dispense_id"]
            isOneToOne: false
            referencedRelation: "native_dispenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_allocations_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_allocations_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: true
            referencedRelation: "inventory_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      native_dispense_correction_events: {
        Row: {
          actor_id: string
          authorization_id: string
          created_at: string
          dispense_id: string
          document: NonNullable<Json>
          id: string
          kind: string
          pet_id: string
          prior_event_id: string | null
          record_hash: string
          reviewed_context: NonNullable<Json>
          sequence: number
        }
        Insert: {
          actor_id: string
          authorization_id: string
          created_at: string
          dispense_id: string
          document: NonNullable<Json>
          id: string
          kind: string
          pet_id: string
          prior_event_id?: string | null
          record_hash: string
          reviewed_context: NonNullable<Json>
          sequence: number
        }
        Update: {
          actor_id?: string
          authorization_id?: string
          created_at?: string
          dispense_id?: string
          document?: NonNullable<Json>
          id?: string
          kind?: string
          pet_id?: string
          prior_event_id?: string | null
          record_hash?: string
          reviewed_context?: NonNullable<Json>
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_dispense_correction_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_correction_events_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_correction_events_dispense_id_fkey"
            columns: ["dispense_id"]
            isOneToOne: false
            referencedRelation: "native_dispenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_correction_events_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_correction_events_prior_event_id_fkey"
            columns: ["prior_event_id"]
            isOneToOne: true
            referencedRelation: "native_dispense_correction_events"
            referencedColumns: ["id"]
          },
        ]
      }
      native_dispense_correction_operations: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
          native_correction_receipt: Json | null
        }
        Insert: {
          actor_id: string
          created_at: string
          id: string
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          request?: NonNullable<Json>
          request_hash?: string
          result?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "native_dispense_correction_operations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_correction_operations_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "native_dispense_correction_events"
            referencedColumns: ["id"]
          },
        ]
      }
      native_dispense_credit_links: {
        Row: {
          authorization_id: string
          dispense_id: string
          id: string
          invoice_id: string
          invoice_item_id: string
          pet_id: string
        }
        Insert: {
          authorization_id: string
          dispense_id: string
          id: string
          invoice_id: string
          invoice_item_id: string
          pet_id: string
        }
        Update: {
          authorization_id?: string
          dispense_id?: string
          id?: string
          invoice_id?: string
          invoice_item_id?: string
          pet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_dispense_credit_links_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_credit_links_dispense_id_fkey"
            columns: ["dispense_id"]
            isOneToOne: false
            referencedRelation: "native_dispenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_credit_links_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "billing_credits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_credit_links_id_fkey1"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "native_dispense_finance_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_credit_links_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_credit_links_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "billing_invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_credit_links_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      native_dispense_finance_closures: {
        Row: {
          actor_id: string
          closed_at: string
          id: string
          record_hash: string
          request: NonNullable<Json>
          request_hash: string
        }
        Insert: {
          actor_id: string
          closed_at: string
          id: string
          record_hash: string
          request: NonNullable<Json>
          request_hash: string
        }
        Update: {
          actor_id?: string
          closed_at?: string
          id?: string
          record_hash?: string
          request?: NonNullable<Json>
          request_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_dispense_finance_closures_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_dispense_finance_operations: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
        }
        Insert: {
          actor_id: string
          created_at: string
          id: string
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          request?: NonNullable<Json>
          request_hash?: string
          result?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "native_dispense_finance_operations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_dispense_refund_links: {
        Row: {
          authorization_id: string
          credit_id: string
          dispense_id: string
          id: string
          invoice_id: string
          invoice_item_id: string
          payment_id: string
          pet_id: string
        }
        Insert: {
          authorization_id: string
          credit_id: string
          dispense_id: string
          id: string
          invoice_id: string
          invoice_item_id: string
          payment_id: string
          pet_id: string
        }
        Update: {
          authorization_id?: string
          credit_id?: string
          dispense_id?: string
          id?: string
          invoice_id?: string
          invoice_item_id?: string
          payment_id?: string
          pet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_dispense_refund_links_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_refund_links_credit_id_fkey"
            columns: ["credit_id"]
            isOneToOne: false
            referencedRelation: "native_dispense_credit_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_refund_links_dispense_id_fkey"
            columns: ["dispense_id"]
            isOneToOne: false
            referencedRelation: "native_dispenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_refund_links_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "invoice_refund_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_refund_links_id_fkey1"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "native_dispense_finance_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_refund_links_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_refund_links_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "billing_invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_refund_links_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "invoice_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispense_refund_links_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      native_dispenses: {
        Row: {
          actor_id: string
          authorization_id: string
          dispensed_at: string
          document: NonNullable<Json>
          id: string
          invoice_id: string
          invoice_item_id: string
          pet_id: string
          quantity: number
          slot_id: string
        }
        Insert: {
          actor_id: string
          authorization_id: string
          dispensed_at: string
          document: NonNullable<Json>
          id: string
          invoice_id: string
          invoice_item_id: string
          pet_id: string
          quantity: number
          slot_id: string
        }
        Update: {
          actor_id?: string
          authorization_id?: string
          dispensed_at?: string
          document?: NonNullable<Json>
          id?: string
          invoice_id?: string
          invoice_item_id?: string
          pet_id?: string
          quantity?: number
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_dispenses_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispenses_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispenses_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispenses_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: true
            referencedRelation: "billing_invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispenses_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_dispenses_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "native_fill_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      native_estimate_decision_access_budget: {
        Row: {
          grant_id: string
          used: number
          window_started_at: string
        }
        Insert: {
          grant_id: string
          used: number
          window_started_at: string
        }
        Update: {
          grant_id?: string
          used?: number
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_estimate_decision_access_budget_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: true
            referencedRelation: "native_estimate_decision_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      native_estimate_decision_closures: {
        Row: {
          closed_at: string
          closed_by: NonNullable<Json>
          family: string
          id: string
          mutation: NonNullable<Json>
          principal: NonNullable<Json>
          reason: string | null
          record_hash: string
          request_hash: string
          native_estdec_closure_document: Json | null
        }
        Insert: {
          closed_at: string
          closed_by: NonNullable<Json>
          family: string
          id: string
          mutation: NonNullable<Json>
          principal: NonNullable<Json>
          reason?: string | null
          record_hash: string
          request_hash: string
        }
        Update: {
          closed_at?: string
          closed_by?: NonNullable<Json>
          family?: string
          id?: string
          mutation?: NonNullable<Json>
          principal?: NonNullable<Json>
          reason?: string | null
          record_hash?: string
          request_hash?: string
        }
        Relationships: []
      }
      native_estimate_decision_grant_captures: {
        Row: {
          capability_context: string
          captured_at: string
          context_hash: string
          grant_id: string
          key_version: string
          origin: string
          record_hash: string
          token_hash: string
        }
        Insert: {
          capability_context: string
          captured_at: string
          context_hash: string
          grant_id: string
          key_version: string
          origin: string
          record_hash: string
          token_hash: string
        }
        Update: {
          capability_context?: string
          captured_at?: string
          context_hash?: string
          grant_id?: string
          key_version?: string
          origin?: string
          record_hash?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_estimate_decision_grant_captures_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: true
            referencedRelation: "native_estimate_decision_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      native_estimate_decision_grant_events: {
        Row: {
          created_at: string
          document: NonNullable<Json>
          estimate_id: string
          grant_id: string
          grant_version: number
          id: string
          previous_hash: string | null
          sequence: number
        }
        Insert: {
          created_at: string
          document: NonNullable<Json>
          estimate_id: string
          grant_id: string
          grant_version: number
          id: string
          previous_hash?: string | null
          sequence: number
        }
        Update: {
          created_at?: string
          document?: NonNullable<Json>
          estimate_id?: string
          grant_id?: string
          grant_version?: number
          id?: string
          previous_hash?: string | null
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_estimate_decision_grant_events_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "native_estimate_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_estimate_decision_grant_events_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "native_estimate_decision_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      native_estimate_decision_grants: {
        Row: {
          actor_id: string
          created_at: string
          estimate_id: string
          expires_at: string
          id: string
          publication_id: string
          request: NonNullable<Json>
          request_hash: string
        }
        Insert: {
          actor_id: string
          created_at: string
          estimate_id: string
          expires_at: string
          id: string
          publication_id: string
          request: NonNullable<Json>
          request_hash: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          estimate_id?: string
          expires_at?: string
          id?: string
          publication_id?: string
          request?: NonNullable<Json>
          request_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_estimate_decision_grants_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_estimate_decision_grants_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "native_estimate_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_estimate_decision_grants_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "native_estimate_publication_events"
            referencedColumns: ["id"]
          },
        ]
      }
      native_estimate_decision_operations: {
        Row: {
          created_at: string
          family: string
          id: string
          mutation: NonNullable<Json>
          principal: NonNullable<Json>
          receipt: NonNullable<Json>
          request_hash: string
        }
        Insert: {
          created_at: string
          family: string
          id: string
          mutation: NonNullable<Json>
          principal: NonNullable<Json>
          receipt: NonNullable<Json>
          request_hash: string
        }
        Update: {
          created_at?: string
          family?: string
          id?: string
          mutation?: NonNullable<Json>
          principal?: NonNullable<Json>
          receipt?: NonNullable<Json>
          request_hash?: string
        }
        Relationships: []
      }
      native_estimate_decisions: {
        Row: {
          created_at: string
          document: NonNullable<Json>
          estimate_id: string
          id: string
          principal: NonNullable<Json>
          publication_id: string
          request_hash: string
          sequence: number
        }
        Insert: {
          created_at: string
          document: NonNullable<Json>
          estimate_id: string
          id: string
          principal: NonNullable<Json>
          publication_id: string
          request_hash: string
          sequence: number
        }
        Update: {
          created_at?: string
          document?: NonNullable<Json>
          estimate_id?: string
          id?: string
          principal?: NonNullable<Json>
          publication_id?: string
          request_hash?: string
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_estimate_decisions_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "native_estimate_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_estimate_decisions_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: true
            referencedRelation: "native_estimate_publication_events"
            referencedColumns: ["id"]
          },
        ]
      }
      native_estimate_draft_closures: {
        Row: {
          actor_id: string
          closed_at: string
          id: string
          record_hash: string
          request: NonNullable<Json>
          request_hash: string
        }
        Insert: {
          actor_id: string
          closed_at: string
          id: string
          record_hash: string
          request: NonNullable<Json>
          request_hash: string
        }
        Update: {
          actor_id?: string
          closed_at?: string
          id?: string
          record_hash?: string
          request?: NonNullable<Json>
          request_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_estimate_draft_closures_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_estimate_draft_operations: {
        Row: {
          actor_id: string
          created_at: string
          estimate_id: string
          id: string
          request: NonNullable<Json>
          request_hash: string
          version: number
        }
        Insert: {
          actor_id: string
          created_at: string
          estimate_id: string
          id: string
          request: NonNullable<Json>
          request_hash: string
          version: number
        }
        Update: {
          actor_id?: string
          created_at?: string
          estimate_id?: string
          id?: string
          request?: NonNullable<Json>
          request_hash?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_estimate_draft_operations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_estimate_draft_operations_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "native_estimate_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      native_estimate_draft_revisions: {
        Row: {
          catalog: NonNullable<Json>
          document: NonNullable<Json>
          estimate_id: string
          operation_id: string
          previous_hash: string | null
          record_hash: string
          version: number
        }
        Insert: {
          catalog: NonNullable<Json>
          document: NonNullable<Json>
          estimate_id: string
          operation_id: string
          previous_hash?: string | null
          record_hash: string
          version: number
        }
        Update: {
          catalog?: NonNullable<Json>
          document?: NonNullable<Json>
          estimate_id?: string
          operation_id?: string
          previous_hash?: string | null
          record_hash?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_estimate_draft_revisions_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "native_estimate_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_estimate_draft_revisions_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "native_estimate_draft_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      native_estimate_drafts: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          id: string
          pet_id: string
        }
        Insert: {
          client_id: string
          created_at: string
          created_by: string
          id: string
          pet_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          id?: string
          pet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_estimate_drafts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_estimate_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_estimate_drafts_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      native_estimate_publication_artifacts: {
        Row: {
          bytes: string
          captured_at: string
          id: string
          metadata: NonNullable<Json>
        }
        Insert: {
          bytes: string
          captured_at: string
          id: string
          metadata: NonNullable<Json>
        }
        Update: {
          bytes?: string
          captured_at?: string
          id?: string
          metadata?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "native_estimate_publication_artifacts_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "native_estimate_publication_preparations"
            referencedColumns: ["id"]
          },
        ]
      }
      native_estimate_publication_closures: {
        Row: {
          actor_id: string
          closed_at: string
          id: string
          mutation: NonNullable<Json>
          record_hash: string
          request_hash: string
        }
        Insert: {
          actor_id: string
          closed_at: string
          id: string
          mutation: NonNullable<Json>
          record_hash: string
          request_hash: string
        }
        Update: {
          actor_id?: string
          closed_at?: string
          id?: string
          mutation?: NonNullable<Json>
          record_hash?: string
          request_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_estimate_publication_closures_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_estimate_publication_events: {
        Row: {
          actor_id: string
          created_at: string
          document: NonNullable<Json>
          estimate_id: string
          id: string
          mutation: NonNullable<Json>
          request_hash: string
          version: number
        }
        Insert: {
          actor_id: string
          created_at: string
          document: NonNullable<Json>
          estimate_id: string
          id: string
          mutation: NonNullable<Json>
          request_hash: string
          version: number
        }
        Update: {
          actor_id?: string
          created_at?: string
          document?: NonNullable<Json>
          estimate_id?: string
          id?: string
          mutation?: NonNullable<Json>
          request_hash?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_estimate_publication_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_estimate_publication_events_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "native_estimate_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      native_estimate_publication_preparations: {
        Row: {
          actor_id: string
          content_hash: string
          context: NonNullable<Json>
          created_at: string
          id: string
          request: NonNullable<Json>
          request_hash: string
          snapshot: NonNullable<Json>
          source_hash: string
        }
        Insert: {
          actor_id: string
          content_hash: string
          context: NonNullable<Json>
          created_at: string
          id: string
          request: NonNullable<Json>
          request_hash: string
          snapshot: NonNullable<Json>
          source_hash: string
        }
        Update: {
          actor_id?: string
          content_hash?: string
          context?: NonNullable<Json>
          created_at?: string
          id?: string
          request?: NonNullable<Json>
          request_hash?: string
          snapshot?: NonNullable<Json>
          source_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_estimate_publication_preparations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_fill_slots: {
        Row: {
          authorization_id: string
          close_reason: string | null
          closed_at: string | null
          closed_by: string | null
          closure_kind: string | null
          dispensed_quantity: number
          id: string
          maximum_quantity: number
          opened_at: string
          opened_by: string
          remaining_quantity: number
          slot_index: number
          state: string
          version: number
          native_fulfillment_slot: Json | null
        }
        Insert: {
          authorization_id: string
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closure_kind?: string | null
          dispensed_quantity: number
          id: string
          maximum_quantity: number
          opened_at: string
          opened_by: string
          remaining_quantity: number
          slot_index: number
          state: string
          version: number
        }
        Update: {
          authorization_id?: string
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closure_kind?: string | null
          dispensed_quantity?: number
          id?: string
          maximum_quantity?: number
          opened_at?: string
          opened_by?: string
          remaining_quantity?: number
          slot_index?: number
          state?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_fill_slots_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_fill_slots_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_fill_slots_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_fulfillment_events: {
        Row: {
          authorization_id: string
          document: NonNullable<Json>
          id: string
          kind: string
          version: number
        }
        Insert: {
          authorization_id: string
          document: NonNullable<Json>
          id: string
          kind: string
          version: number
        }
        Update: {
          authorization_id?: string
          document?: NonNullable<Json>
          id?: string
          kind?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_fulfillment_events_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      native_fulfillment_operations: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          operation: string
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
          native_fulfillment_receipt: Json | null
        }
        Insert: {
          actor_id: string
          created_at: string
          id: string
          operation: string
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          operation?: string
          request?: NonNullable<Json>
          request_hash?: string
          result?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "native_fulfillment_operations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_pickups: {
        Row: {
          actor_id: string
          authorization_id: string
          dispense_id: string
          document: NonNullable<Json>
          id: string
          pet_id: string
          picked_up_at: string
        }
        Insert: {
          actor_id: string
          authorization_id: string
          dispense_id: string
          document: NonNullable<Json>
          id: string
          pet_id: string
          picked_up_at: string
        }
        Update: {
          actor_id?: string
          authorization_id?: string
          dispense_id?: string
          document?: NonNullable<Json>
          id?: string
          pet_id?: string
          picked_up_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_pickups_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_pickups_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_pickups_dispense_id_fkey"
            columns: ["dispense_id"]
            isOneToOne: true
            referencedRelation: "native_dispenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_pickups_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      native_prescriber_configurations: {
        Row: {
          configured_at: string
          configured_by: string
          fields: NonNullable<Json>
          user_id: string
          version: number
        }
        Insert: {
          configured_at: string
          configured_by: string
          fields: NonNullable<Json>
          user_id: string
          version: number
        }
        Update: {
          configured_at?: string
          configured_by?: string
          fields?: NonNullable<Json>
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_prescriber_configurations_configured_by_fkey"
            columns: ["configured_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_prescriber_configurations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_prescription_authorization_events: {
        Row: {
          action: string
          actor_id: string
          authorization_hash: string
          authorization_id: string
          created_at: string
          event_version: number
          id: string
          pet_id: string
          prior_event_id: string | null
          reason: string
          reconciliation: Json | null
          record_hash: string
          replacement_id: string | null
          reviewed_context: NonNullable<Json>
          reviewed_context_hash: string
          native_rx_event_projection: Json | null
        }
        Insert: {
          action: string
          actor_id: string
          authorization_hash: string
          authorization_id: string
          created_at: string
          event_version: number
          id: string
          pet_id: string
          prior_event_id?: string | null
          reason: string
          reconciliation?: Json | null
          record_hash: string
          replacement_id?: string | null
          reviewed_context: NonNullable<Json>
          reviewed_context_hash: string
        }
        Update: {
          action?: string
          actor_id?: string
          authorization_hash?: string
          authorization_id?: string
          created_at?: string
          event_version?: number
          id?: string
          pet_id?: string
          prior_event_id?: string | null
          reason?: string
          reconciliation?: Json | null
          record_hash?: string
          replacement_id?: string | null
          reviewed_context?: NonNullable<Json>
          reviewed_context_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_prescription_authorization_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_prescription_authorization_events_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_prescription_authorization_events_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_prescription_authorization_events_prior_event_id_fkey"
            columns: ["prior_event_id"]
            isOneToOne: true
            referencedRelation: "native_prescription_authorization_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_prescription_authorization_events_replacement_id_fkey"
            columns: ["replacement_id"]
            isOneToOne: true
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      native_prescription_authorizations: {
        Row: {
          client_id: string
          document: NonNullable<Json>
          draft_id: string
          id: string
          pet_id: string
        }
        Insert: {
          client_id: string
          document: NonNullable<Json>
          draft_id: string
          id: string
          pet_id: string
        }
        Update: {
          client_id?: string
          document?: NonNullable<Json>
          draft_id?: string
          id?: string
          pet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_prescription_authorizations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_prescription_authorizations_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: true
            referencedRelation: "native_prescription_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_prescription_authorizations_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      native_prescription_draft_revisions: {
        Row: {
          draft_id: string
          operation_id: string
          snapshot: NonNullable<Json>
          version: number
        }
        Insert: {
          draft_id: string
          operation_id: string
          snapshot: NonNullable<Json>
          version: number
        }
        Update: {
          draft_id?: string
          operation_id?: string
          snapshot?: NonNullable<Json>
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_prescription_draft_revisions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "native_prescription_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_prescription_draft_revisions_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "native_prescription_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      native_prescription_drafts: {
        Row: {
          authorization_id: string | null
          client_id: string
          created_at: string
          created_by: string
          fields: NonNullable<Json>
          id: string
          pet_id: string
          status: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          authorization_id?: string | null
          client_id: string
          created_at: string
          created_by: string
          fields: NonNullable<Json>
          id: string
          pet_id: string
          status: string
          updated_at: string
          updated_by: string
          version: number
        }
        Update: {
          authorization_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string
          fields?: NonNullable<Json>
          id?: string
          pet_id?: string
          status?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_prescription_drafts_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: true
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_prescription_drafts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_prescription_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_prescription_drafts_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_prescription_drafts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_prescription_operations: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          operation: string
          pet_id: string | null
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
          native_rx_receipt: Json | null
        }
        Insert: {
          actor_id: string
          created_at: string
          id: string
          operation: string
          pet_id?: string | null
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          operation?: string
          pet_id?: string | null
          request?: NonNullable<Json>
          request_hash?: string
          result?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "native_prescription_operations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_prescription_operations_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      native_refill_events: {
        Row: {
          action: string
          actor_id: string
          after_snapshot: NonNullable<Json>
          before_snapshot: Json | null
          created_at: string
          fulfillment_reference: Json | null
          id: string
          link_context: Json | null
          prior_event_id: string | null
          reason: string
          refill_id: string
          revision: number
          native_refill_event: Json | null
        }
        Insert: {
          action: string
          actor_id: string
          after_snapshot: NonNullable<Json>
          before_snapshot?: Json | null
          created_at: string
          fulfillment_reference?: Json | null
          id: string
          link_context?: Json | null
          prior_event_id?: string | null
          reason: string
          refill_id: string
          revision: number
        }
        Update: {
          action?: string
          actor_id?: string
          after_snapshot?: NonNullable<Json>
          before_snapshot?: Json | null
          created_at?: string
          fulfillment_reference?: Json | null
          id?: string
          link_context?: Json | null
          prior_event_id?: string | null
          reason?: string
          refill_id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_refill_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_refill_events_prior_event_id_fkey"
            columns: ["prior_event_id"]
            isOneToOne: true
            referencedRelation: "native_refill_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_refill_events_refill_id_fkey"
            columns: ["refill_id"]
            isOneToOne: false
            referencedRelation: "native_refills"
            referencedColumns: ["id"]
          },
        ]
      }
      native_refill_operations: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          operation: string
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
          native_refill_receipt: Json | null
        }
        Insert: {
          actor_id: string
          created_at: string
          id: string
          operation: string
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          operation?: string
          request?: NonNullable<Json>
          request_hash?: string
          result?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "native_refill_operations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_refills: {
        Row: {
          assigned_to: string | null
          authorization_hash: string | null
          authorization_id: string | null
          channel: string
          client_id: string
          created_at: string
          created_by: string
          id: string
          medication_requested: string
          pet_id: string
          requester_note: string | null
          state: string
          updated_at: string
          updated_by: string
          version: number
          native_refill_read_projection: Json | null
        }
        Insert: {
          assigned_to?: string | null
          authorization_hash?: string | null
          authorization_id?: string | null
          channel: string
          client_id: string
          created_at: string
          created_by: string
          id: string
          medication_requested: string
          pet_id: string
          requester_note?: string | null
          state: string
          updated_at: string
          updated_by: string
          version: number
        }
        Update: {
          assigned_to?: string | null
          authorization_hash?: string | null
          authorization_id?: string | null
          channel?: string
          client_id?: string
          created_at?: string
          created_by?: string
          id?: string
          medication_requested?: string
          pet_id?: string
          requester_note?: string | null
          state?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_refills_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_refills_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_refills_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_refills_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_refills_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_refills_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_return_compensation_links: {
        Row: {
          allocation_id: string
          event_id: string
          id: string
          lot_id: string
          movement_id: string
          original_movement_id: string
          quantity: number
          target_event_id: string
        }
        Insert: {
          allocation_id: string
          event_id: string
          id: string
          lot_id: string
          movement_id: string
          original_movement_id: string
          quantity: number
          target_event_id: string
        }
        Update: {
          allocation_id?: string
          event_id?: string
          id?: string
          lot_id?: string
          movement_id?: string
          original_movement_id?: string
          quantity?: number
          target_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_return_compensation_links_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "native_dispense_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_compensation_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "native_return_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_compensation_links_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_compensation_links_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: true
            referencedRelation: "inventory_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_compensation_links_original_movement_id_fkey"
            columns: ["original_movement_id"]
            isOneToOne: false
            referencedRelation: "inventory_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_compensation_links_target_event_id_fkey"
            columns: ["target_event_id"]
            isOneToOne: false
            referencedRelation: "native_return_events"
            referencedColumns: ["id"]
          },
        ]
      }
      native_return_discrepancy_correction_links: {
        Row: {
          case_id: string
          correction_id: string
          id: string
          resolution_id: string
        }
        Insert: {
          case_id: string
          correction_id: string
          id?: string
          resolution_id: string
        }
        Update: {
          case_id?: string
          correction_id?: string
          id?: string
          resolution_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_return_discrepancy_correction_links_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "native_return_discrepancy_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_discrepancy_correction_links_correction_id_fkey"
            columns: ["correction_id"]
            isOneToOne: true
            referencedRelation: "native_return_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_discrepancy_correction_links_resolution_id_fkey"
            columns: ["resolution_id"]
            isOneToOne: false
            referencedRelation: "native_return_discrepancy_events"
            referencedColumns: ["id"]
          },
        ]
      }
      native_return_discrepancy_events: {
        Row: {
          action: string
          actor_id: string
          authorization_id: string
          case_id: string
          created_at: string
          dispense_id: string
          document: NonNullable<Json>
          id: string
          pet_id: string
          prior_event_id: string | null
          record_hash: string
          reviewed_context: NonNullable<Json>
          sequence: number
        }
        Insert: {
          action: string
          actor_id: string
          authorization_id: string
          case_id: string
          created_at: string
          dispense_id: string
          document: NonNullable<Json>
          id: string
          pet_id: string
          prior_event_id?: string | null
          record_hash: string
          reviewed_context: NonNullable<Json>
          sequence: number
        }
        Update: {
          action?: string
          actor_id?: string
          authorization_id?: string
          case_id?: string
          created_at?: string
          dispense_id?: string
          document?: NonNullable<Json>
          id?: string
          pet_id?: string
          prior_event_id?: string | null
          record_hash?: string
          reviewed_context?: NonNullable<Json>
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_return_discrepancy_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_discrepancy_events_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_discrepancy_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "native_return_discrepancy_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_discrepancy_events_dispense_id_fkey"
            columns: ["dispense_id"]
            isOneToOne: false
            referencedRelation: "native_dispenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_discrepancy_events_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_discrepancy_events_prior_event_id_fkey"
            columns: ["prior_event_id"]
            isOneToOne: true
            referencedRelation: "native_return_discrepancy_events"
            referencedColumns: ["id"]
          },
        ]
      }
      native_return_discrepancy_operations: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
        }
        Insert: {
          actor_id: string
          created_at: string
          id: string
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          request?: NonNullable<Json>
          request_hash?: string
          result?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "native_return_discrepancy_operations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_discrepancy_operations_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "native_return_discrepancy_events"
            referencedColumns: ["id"]
          },
        ]
      }
      native_return_events: {
        Row: {
          action: string
          actor_id: string
          authorization_id: string
          created_at: string
          dispense_id: string
          document: NonNullable<Json>
          id: string
          intake_id: string | null
          pet_id: string
          prior_event_id: string | null
          record_hash: string
          reviewed_context: NonNullable<Json>
          sequence: number
        }
        Insert: {
          action: string
          actor_id: string
          authorization_id: string
          created_at: string
          dispense_id: string
          document: NonNullable<Json>
          id: string
          intake_id?: string | null
          pet_id: string
          prior_event_id?: string | null
          record_hash: string
          reviewed_context: NonNullable<Json>
          sequence: number
        }
        Update: {
          action?: string
          actor_id?: string
          authorization_id?: string
          created_at?: string
          dispense_id?: string
          document?: NonNullable<Json>
          id?: string
          intake_id?: string | null
          pet_id?: string
          prior_event_id?: string | null
          record_hash?: string
          reviewed_context?: NonNullable<Json>
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_return_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_events_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_events_dispense_id_fkey"
            columns: ["dispense_id"]
            isOneToOne: false
            referencedRelation: "native_dispenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_events_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "native_return_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_events_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_events_prior_event_id_fkey"
            columns: ["prior_event_id"]
            isOneToOne: true
            referencedRelation: "native_return_events"
            referencedColumns: ["id"]
          },
        ]
      }
      native_return_operations: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
          native_return_receipt: Json | null
        }
        Insert: {
          actor_id: string
          created_at: string
          id: string
          request: NonNullable<Json>
          request_hash: string
          result: NonNullable<Json>
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          request?: NonNullable<Json>
          request_hash?: string
          result?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "native_return_operations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_operations_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "native_return_events"
            referencedColumns: ["id"]
          },
        ]
      }
      native_return_policy_decisions: {
        Row: {
          actor_id: string
          created_at: string
          document: NonNullable<Json>
          id: string
          request: NonNullable<Json>
          request_hash: string
          version: number
          native_return_policy_receipt: Json | null
        }
        Insert: {
          actor_id: string
          created_at: string
          document: NonNullable<Json>
          id: string
          request: NonNullable<Json>
          request_hash: string
          version: number
        }
        Update: {
          actor_id?: string
          created_at?: string
          document?: NonNullable<Json>
          id?: string
          request?: NonNullable<Json>
          request_hash?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_return_policy_decisions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_return_policy_state: {
        Row: {
          decision_id: string | null
          id: boolean
          version: number
        }
        Insert: {
          decision_id?: string | null
          id?: boolean
          version: number
        }
        Update: {
          decision_id?: string | null
          id?: boolean
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_return_policy_state_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "native_return_policy_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      native_return_stock_links: {
        Row: {
          allocation_id: string
          event_id: string
          id: string
          lot_id: string
          movement_id: string
          quantity: number
        }
        Insert: {
          allocation_id: string
          event_id: string
          id: string
          lot_id: string
          movement_id: string
          quantity: number
        }
        Update: {
          allocation_id?: string
          event_id?: string
          id?: string
          lot_id?: string
          movement_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "native_return_stock_links_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "native_dispense_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_stock_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "native_return_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_stock_links_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_return_stock_links_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: true
            referencedRelation: "inventory_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      native_slot_closures: {
        Row: {
          actor_id: string
          authorization_id: string
          created_at: string
          document: NonNullable<Json>
          id: string
          pet_id: string
          slot_id: string
        }
        Insert: {
          actor_id: string
          authorization_id: string
          created_at: string
          document: NonNullable<Json>
          id: string
          pet_id: string
          slot_id: string
        }
        Update: {
          actor_id?: string
          authorization_id?: string
          created_at?: string
          document?: NonNullable<Json>
          id?: string
          pet_id?: string
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_slot_closures_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_slot_closures_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "native_prescription_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_slot_closures_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "native_slot_closures_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: true
            referencedRelation: "native_fill_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      on_call_schedules: {
        Row: {
          created_at: string
          dvm_id: string
          end_time: string
          id: string
          notes: string | null
          phone_number: string | null
          start_time: string
        }
        Insert: {
          created_at?: string
          dvm_id: string
          end_time: string
          id?: string
          notes?: string | null
          phone_number?: string | null
          start_time: string
        }
        Update: {
          created_at?: string
          dvm_id?: string
          end_time?: string
          id?: string
          notes?: string | null
          phone_number?: string | null
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "on_call_schedules_dvm_id_fkey"
            columns: ["dvm_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_deliveries: {
        Row: {
          accepted_at: string | null
          appointment_reminder_id: string | null
          attempt_count: number
          canceled_at: string | null
          channel: Database["public"]["Enums"]["channel_type"]
          client_id: string | null
          conversation_id: string | null
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error_text: string | null
          lease_owner: string | null
          leased_at: string | null
          leased_until: string | null
          max_attempts: number
          message_id: string | null
          next_attempt_at: string
          payload: NonNullable<Json>
          provider: string | null
          provider_message_id: string | null
          recipient: string
          requested_by: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["outbound_delivery_status"]
          status_note: string | null
          unknown_at: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          appointment_reminder_id?: string | null
          attempt_count?: number
          canceled_at?: string | null
          channel: Database["public"]["Enums"]["channel_type"]
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key: string
          last_error_text?: string | null
          lease_owner?: string | null
          leased_at?: string | null
          leased_until?: string | null
          max_attempts?: number
          message_id?: string | null
          next_attempt_at?: string
          payload?: NonNullable<Json>
          provider?: string | null
          provider_message_id?: string | null
          recipient: string
          requested_by?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["outbound_delivery_status"]
          status_note?: string | null
          unknown_at?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          appointment_reminder_id?: string | null
          attempt_count?: number
          canceled_at?: string | null
          channel?: Database["public"]["Enums"]["channel_type"]
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key?: string
          last_error_text?: string | null
          lease_owner?: string | null
          leased_at?: string | null
          leased_until?: string | null
          max_attempts?: number
          message_id?: string | null
          next_attempt_at?: string
          payload?: NonNullable<Json>
          provider?: string | null
          provider_message_id?: string | null
          recipient?: string
          requested_by?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["outbound_delivery_status"]
          status_note?: string | null
          unknown_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_deliveries_appointment_reminder_id_fkey"
            columns: ["appointment_reminder_id"]
            isOneToOne: false
            referencedRelation: "appointment_reminders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_deliveries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_deliveries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_deliveries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "outbound_deliveries_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["latest_message_id"]
          },
          {
            foreignKeyName: "outbound_deliveries_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_message_attempts: {
        Row: {
          channel: string
          client_id: string | null
          conversation_id: string | null
          created_at: string
          delivered: boolean
          error_text: string | null
          id: string
          message_id: string | null
          provider: string | null
          recipient: string
          status_note: string | null
          user_id: string | null
        }
        Insert: {
          channel: string
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered?: boolean
          error_text?: string | null
          id?: string
          message_id?: string | null
          provider?: string | null
          recipient: string
          status_note?: string | null
          user_id?: string | null
        }
        Update: {
          channel?: string
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered?: boolean
          error_text?: string | null
          id?: string
          message_id?: string | null
          provider?: string | null
          recipient?: string
          status_note?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outbound_message_attempts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_message_attempts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_message_attempts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "outbound_message_attempts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["latest_message_id"]
          },
          {
            foreignKeyName: "outbound_message_attempts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox_retry_actions: {
        Row: {
          actor_id: string
          created_at: string
          expected_work_hash: string
          id: string
          outbox_id: string
          previous_revision: number
          queued_revision: number
          reason: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          expected_work_hash: string
          id: string
          outbox_id: string
          previous_revision: number
          queued_revision: number
          reason: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          expected_work_hash?: string
          id?: string
          outbox_id?: string
          previous_revision?: number
          queued_revision?: number
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbox_retry_actions_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "communication_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_anesthesia_records: {
        Row: {
          assessment: string
          created_at: string
          created_by: string
          ended_at: string | null
          events: NonNullable<Json>
          id: string
          observations: NonNullable<Json>
          original_document_id: string | null
          pet_id: string
          plan: string
          procedure_name: string
          recovery_notes: string
          signed_at: string | null
          signed_by: string | null
          source: string
          source_description: string
          started_at: string
          status: string
          team: string
          updated_at: string
          updated_by: string
          version: number
          anesthesia_validate: undefined | null
        }
        Insert: {
          assessment?: string
          created_at?: string
          created_by: string
          ended_at?: string | null
          events?: NonNullable<Json>
          id: string
          observations?: NonNullable<Json>
          original_document_id?: string | null
          pet_id: string
          plan?: string
          procedure_name: string
          recovery_notes?: string
          signed_at?: string | null
          signed_by?: string | null
          source: string
          source_description?: string
          started_at: string
          status?: string
          team: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          assessment?: string
          created_at?: string
          created_by?: string
          ended_at?: string | null
          events?: NonNullable<Json>
          id?: string
          observations?: NonNullable<Json>
          original_document_id?: string | null
          pet_id?: string
          plan?: string
          procedure_name?: string
          recovery_notes?: string
          signed_at?: string | null
          signed_by?: string | null
          source?: string
          source_description?: string
          started_at?: string
          status?: string
          team?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_anesthesia_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_anesthesia_records_original_document_id_fkey"
            columns: ["original_document_id"]
            isOneToOne: false
            referencedRelation: "patient_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_anesthesia_records_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_anesthesia_records_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_anesthesia_records_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_documents: {
        Row: {
          category: string
          created_at: string
          created_by: string
          document_date: string | null
          encounter_id: string | null
          file_name: string
          file_path: string
          file_size: number
          finalized_at: string | null
          id: string
          mime_type: string
          pet_id: string
          source: string
          status: string
          version: number
          visibility: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          category: string
          created_at?: string
          created_by: string
          document_date?: string | null
          encounter_id?: string | null
          file_name: string
          file_path: string
          file_size: number
          finalized_at?: string | null
          id: string
          mime_type: string
          pet_id: string
          source?: string
          status?: string
          version?: number
          visibility?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string
          document_date?: string | null
          encounter_id?: string | null
          file_name?: string
          file_path?: string
          file_size?: number
          finalized_at?: string | null
          id?: string
          mime_type?: string
          pet_id?: string
          source?: string
          status?: string
          version?: number
          visibility?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_documents_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "clinical_encounters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_documents_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_lab_orders: {
        Row: {
          accession: string
          collected_date: string | null
          created_at: string
          created_by: string
          due_date: string | null
          id: string
          interval_anchor: string | null
          interval_days: number | null
          notes: string
          override_reason: string
          pet_id: string
          reminders_enabled: boolean
          result_date: string | null
          result_document_id: string | null
          status: string
          template_id: string | null
          template_version: number | null
          test_name: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          accession?: string
          collected_date?: string | null
          created_at?: string
          created_by: string
          due_date?: string | null
          id: string
          interval_anchor?: string | null
          interval_days?: number | null
          notes?: string
          override_reason?: string
          pet_id: string
          reminders_enabled?: boolean
          result_date?: string | null
          result_document_id?: string | null
          status: string
          template_id?: string | null
          template_version?: number | null
          test_name: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          accession?: string
          collected_date?: string | null
          created_at?: string
          created_by?: string
          due_date?: string | null
          id?: string
          interval_anchor?: string | null
          interval_days?: number | null
          notes?: string
          override_reason?: string
          pet_id?: string
          reminders_enabled?: boolean
          result_date?: string | null
          result_document_id?: string | null
          status?: string
          template_id?: string | null
          template_version?: number | null
          test_name?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_lab_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_lab_orders_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_lab_orders_result_document_id_fkey"
            columns: ["result_document_id"]
            isOneToOne: false
            referencedRelation: "patient_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_lab_orders_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "lab_due_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_lab_orders_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_lesion_corrections: {
        Row: {
          created_at: string
          created_by: string
          id: string
          observation_id: string
          reason: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id: string
          observation_id: string
          reason: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          observation_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_lesion_corrections_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: true
            referencedRelation: "patient_lesion_observations"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_lesion_observations: {
        Row: {
          body_view: string
          created_at: string
          created_by: string
          depth_mm: number | null
          id: string
          label: string
          length_mm: number | null
          lesion_id: string
          notes: string
          observed_at: string
          photo_document_id: string | null
          request: NonNullable<Json>
          width_mm: number | null
          x: number
          y: number
        }
        Insert: {
          body_view: string
          created_at?: string
          created_by: string
          depth_mm?: number | null
          id: string
          label: string
          length_mm?: number | null
          lesion_id: string
          notes?: string
          observed_at: string
          photo_document_id?: string | null
          request: NonNullable<Json>
          width_mm?: number | null
          x: number
          y: number
        }
        Update: {
          body_view?: string
          created_at?: string
          created_by?: string
          depth_mm?: number | null
          id?: string
          label?: string
          length_mm?: number | null
          lesion_id?: string
          notes?: string
          observed_at?: string
          photo_document_id?: string | null
          request?: NonNullable<Json>
          width_mm?: number | null
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_lesion_observations_lesion_id_fkey"
            columns: ["lesion_id"]
            isOneToOne: false
            referencedRelation: "patient_lesions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_lesion_observations_photo_document_id_fkey"
            columns: ["photo_document_id"]
            isOneToOne: false
            referencedRelation: "patient_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_lesions: {
        Row: {
          body_view: string
          created_at: string
          created_by: string
          id: string
          label: string
          pet_id: string
          updated_at: string
          updated_by: string
          version: number
          x: number
          y: number
        }
        Insert: {
          body_view: string
          created_at?: string
          created_by: string
          id: string
          label: string
          pet_id: string
          updated_at?: string
          updated_by: string
          version?: number
          x: number
          y: number
        }
        Update: {
          body_view?: string
          created_at?: string
          created_by?: string
          id?: string
          label?: string
          pet_id?: string
          updated_at?: string
          updated_by?: string
          version?: number
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_lesions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_problems: {
        Row: {
          created_at: string
          created_by: string
          id: string
          importance: string
          notes: string
          onset_date: string | null
          pet_id: string
          status: string
          title: string
          updated_at: string
          updated_by: string
          version: number
          ezyvet_problem_fields: Json | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          importance?: string
          notes?: string
          onset_date?: string | null
          pet_id: string
          status?: string
          title: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          importance?: string
          notes?: string
          onset_date?: string | null
          pet_id?: string
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_problems_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_qol_addenda: {
        Row: {
          content: string
          created_at: string
          created_by: string
          id: string
          qol_id: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by: string
          id: string
          qol_id: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          qol_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_qol_addenda_qol_id_fkey"
            columns: ["qol_id"]
            isOneToOne: false
            referencedRelation: "patient_qol_records"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_qol_records: {
        Row: {
          appetite: string
          comfort: string
          created_at: string
          created_by: string
          drinking: string
          good_days: string
          id: string
          mobility: string
          notes: string
          observed_at: string
          observer: string
          pet_id: string
          signed_at: string | null
          signed_by: string | null
          social_engagement: string
          status: string
          template_version: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          appetite?: string
          comfort?: string
          created_at?: string
          created_by: string
          drinking?: string
          good_days?: string
          id: string
          mobility?: string
          notes?: string
          observed_at: string
          observer: string
          pet_id: string
          signed_at?: string | null
          signed_by?: string | null
          social_engagement?: string
          status?: string
          template_version?: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          appetite?: string
          comfort?: string
          created_at?: string
          created_by?: string
          drinking?: string
          good_days?: string
          id?: string
          mobility?: string
          notes?: string
          observed_at?: string
          observer?: string
          pet_id?: string
          signed_at?: string | null
          signed_by?: string | null
          social_engagement?: string
          status?: string
          template_version?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_qol_records_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_qol_scale_addenda: {
        Row: {
          assessment_id: string
          content: string
          created_at: string
          created_by: string
          id: string
        }
        Insert: {
          assessment_id: string
          content: string
          created_at?: string
          created_by: string
          id: string
        }
        Update: {
          assessment_id?: string
          content?: string
          created_at?: string
          created_by?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_qol_scale_addenda_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "patient_qol_scale_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_qol_scale_assessments: {
        Row: {
          assessed_at: string
          assessor: string
          created_at: string
          created_by: string
          happiness: number | null
          happiness_note: string
          hunger: number | null
          hunger_note: string
          hurt: number | null
          hurt_note: string
          hydration: number | null
          hydration_note: string
          hygiene: number | null
          hygiene_note: string
          id: string
          mobility: number | null
          mobility_note: string
          more_good_days: number | null
          more_good_days_note: string
          notes: string
          pet_id: string
          scale_version: string
          signed_at: string | null
          signed_by: string | null
          status: string
          total: number | null
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          assessed_at: string
          assessor: string
          created_at?: string
          created_by: string
          happiness?: number | null
          happiness_note?: string
          hunger?: number | null
          hunger_note?: string
          hurt?: number | null
          hurt_note?: string
          hydration?: number | null
          hydration_note?: string
          hygiene?: number | null
          hygiene_note?: string
          id: string
          mobility?: number | null
          mobility_note?: string
          more_good_days?: number | null
          more_good_days_note?: string
          notes?: string
          pet_id: string
          scale_version?: string
          signed_at?: string | null
          signed_by?: string | null
          status?: string
          total?: never
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          assessed_at?: string
          assessor?: string
          created_at?: string
          created_by?: string
          happiness?: number | null
          happiness_note?: string
          hunger?: number | null
          hunger_note?: string
          hurt?: number | null
          hurt_note?: string
          hydration?: number | null
          hydration_note?: string
          hygiene?: number | null
          hygiene_note?: string
          id?: string
          mobility?: number | null
          mobility_note?: string
          more_good_days?: number | null
          more_good_days_note?: string
          notes?: string
          pet_id?: string
          scale_version?: string
          signed_at?: string | null
          signed_by?: string | null
          status?: string
          total?: never
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_qol_scale_assessments_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_treatment_corrections: {
        Row: {
          created_at: string
          created_by: string
          id: string
          reason: string
          replacement_id: string | null
          treatment_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id: string
          reason: string
          replacement_id?: string | null
          treatment_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          reason?: string
          replacement_id?: string | null
          treatment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_treatment_corrections_replacement_id_fkey"
            columns: ["replacement_id"]
            isOneToOne: false
            referencedRelation: "patient_treatments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_treatment_corrections_treatment_id_fkey"
            columns: ["treatment_id"]
            isOneToOne: true
            referencedRelation: "patient_treatments"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_treatments: {
        Row: {
          administered_at: string
          created_at: string
          created_by: string
          dose: string
          expires_on: string | null
          historical: boolean
          id: string
          invoice_id: string | null
          kind: string
          lot_id: string | null
          lot_number: string
          manufacturer: string
          next_due_on: string | null
          pet_id: string
          product_id: string | null
          product_name: string
          quantity: number
          request: NonNullable<Json>
          route: string
          site: string
          source: string
          veterinarian: string
          veterinarian_license: string
        }
        Insert: {
          administered_at: string
          created_at?: string
          created_by: string
          dose: string
          expires_on?: string | null
          historical: boolean
          id: string
          invoice_id?: string | null
          kind: string
          lot_id?: string | null
          lot_number: string
          manufacturer: string
          next_due_on?: string | null
          pet_id: string
          product_id?: string | null
          product_name: string
          quantity: number
          request: NonNullable<Json>
          route: string
          site: string
          source: string
          veterinarian: string
          veterinarian_license: string
        }
        Update: {
          administered_at?: string
          created_at?: string
          created_by?: string
          dose?: string
          expires_on?: string | null
          historical?: boolean
          id?: string
          invoice_id?: string | null
          kind?: string
          lot_id?: string | null
          lot_number?: string
          manufacturer?: string
          next_due_on?: string | null
          pet_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          request?: NonNullable<Json>
          route?: string
          site?: string
          source?: string
          veterinarian?: string
          veterinarian_license?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_treatments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_treatments_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_treatments_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_treatments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_vaccine_due_plans: {
        Row: {
          anchor_source: string
          created_at: string
          created_by: string
          current_due_on: string
          group_key: string
          id: string
          interval_days: number
          last_administered_on: string
          override_reason: string
          pet_id: string
          product_id: string
          proposed_due_on: string
          reminders_enabled: boolean
          review_note: string
          status: string
          template_id: string
          template_snapshot: NonNullable<Json>
          template_version: number
          treatment_id: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          anchor_source: string
          created_at?: string
          created_by: string
          current_due_on: string
          group_key: string
          id: string
          interval_days: number
          last_administered_on: string
          override_reason?: string
          pet_id: string
          product_id: string
          proposed_due_on: string
          reminders_enabled?: boolean
          review_note: string
          status: string
          template_id: string
          template_snapshot: NonNullable<Json>
          template_version: number
          treatment_id?: string | null
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          anchor_source?: string
          created_at?: string
          created_by?: string
          current_due_on?: string
          group_key?: string
          id?: string
          interval_days?: number
          last_administered_on?: string
          override_reason?: string
          pet_id?: string
          product_id?: string
          proposed_due_on?: string
          reminders_enabled?: boolean
          review_note?: string
          status?: string
          template_id?: string
          template_snapshot?: NonNullable<Json>
          template_version?: number
          treatment_id?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_vaccine_due_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_vaccine_due_plans_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_vaccine_due_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_vaccine_due_plans_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "vaccine_due_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_vaccine_due_plans_treatment_id_fkey"
            columns: ["treatment_id"]
            isOneToOne: false
            referencedRelation: "patient_treatments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_vaccine_due_plans_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_weights: {
        Row: {
          created_at: string
          id: string
          measured_at: string
          pet_id: string
          recorded_by: string
          unit: string
          weight: number
        }
        Insert: {
          created_at?: string
          id?: string
          measured_at: string
          pet_id: string
          recorded_by: string
          unit: string
          weight: number
        }
        Update: {
          created_at?: string
          id?: string
          measured_at?: string
          pet_id?: string
          recorded_by?: string
          unit?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_weights_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_collection_attempts: {
        Row: {
          created_at: string
          grant_id: string
          request_id: string
        }
        Insert: {
          created_at?: string
          grant_id: string
          request_id: string
        }
        Update: {
          created_at?: string
          grant_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_collection_attempts_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "payment_collection_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_collection_attempts_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "invoice_checkout_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_collection_captures: {
        Row: {
          capability_context: string
          collection_token_hash: string
          context_hash: string
          context_version: number
          created_at: string
          grant_id: string
          key_version: string
          origin: string
          status_token_hash: string
        }
        Insert: {
          capability_context: string
          collection_token_hash: string
          context_hash: string
          context_version?: number
          created_at?: string
          grant_id: string
          key_version: string
          origin: string
          status_token_hash: string
        }
        Update: {
          capability_context?: string
          collection_token_hash?: string
          context_hash?: string
          context_version?: number
          created_at?: string
          grant_id?: string
          key_version?: string
          origin?: string
          status_token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_collection_captures_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: true
            referencedRelation: "payment_collection_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_collection_events: {
        Row: {
          actor_id: string
          context_hash: string | null
          created_at: string
          grant_id: string
          id: string
          kind: string
          reason: string | null
        }
        Insert: {
          actor_id: string
          context_hash?: string | null
          created_at?: string
          grant_id: string
          id?: string
          kind: string
          reason?: string | null
        }
        Update: {
          actor_id?: string
          context_hash?: string | null
          created_at?: string
          grant_id?: string
          id?: string
          kind?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_collection_events_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "payment_collection_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_collection_grants: {
        Row: {
          actor_id: string
          amount_cents: number
          client_id: string
          created_at: string
          currency: string
          expires_at: string
          id: string
          invoice_id: string
          source_hash: string
          status_expires_at: string
        }
        Insert: {
          actor_id: string
          amount_cents: number
          client_id: string
          created_at?: string
          currency?: string
          expires_at: string
          id: string
          invoice_id: string
          source_hash: string
          status_expires_at: string
        }
        Update: {
          actor_id?: string
          amount_cents?: number
          client_id?: string
          created_at?: string
          currency?: string
          expires_at?: string
          id?: string
          invoice_id?: string
          source_hash?: string
          status_expires_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_collection_grants_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_collection_grants_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_delivery_captures: {
        Row: {
          captured_at: string
          message_hash: string
          payload_hash: string
          request_id: string
          sender_config: NonNullable<Json>
        }
        Insert: {
          captured_at?: string
          message_hash: string
          payload_hash: string
          request_id: string
          sender_config: NonNullable<Json>
        }
        Update: {
          captured_at?: string
          message_hash?: string
          payload_hash?: string
          request_id?: string
          sender_config?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "payment_delivery_captures_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "payment_delivery_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_delivery_outbox_links: {
        Row: {
          outbox_id: string
          queued_at: string
          queued_by: string
          request_id: string
          reviewed_message_hash: string
          reviewed_payload_hash: string
        }
        Insert: {
          outbox_id: string
          queued_at?: string
          queued_by: string
          request_id: string
          reviewed_message_hash: string
          reviewed_payload_hash: string
        }
        Update: {
          outbox_id?: string
          queued_at?: string
          queued_by?: string
          request_id?: string
          reviewed_message_hash?: string
          reviewed_payload_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_delivery_outbox_links_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: true
            referencedRelation: "communication_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_delivery_outbox_links_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "payment_delivery_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_delivery_requests: {
        Row: {
          actor_id: string
          amount_cents: number
          body_template: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          grant_id: string
          id: string
          invoice_email_request_id: string | null
          invoice_id: string
          invoice_payload_hash: string | null
          recipient: string
          source_hash: string
          subject: string
        }
        Insert: {
          actor_id: string
          amount_cents: number
          body_template: string
          channel: string
          client_id: string
          conversation_id: string
          created_at?: string
          grant_id: string
          id: string
          invoice_email_request_id?: string | null
          invoice_id: string
          invoice_payload_hash?: string | null
          recipient: string
          source_hash: string
          subject: string
        }
        Update: {
          actor_id?: string
          amount_cents?: number
          body_template?: string
          channel?: string
          client_id?: string
          conversation_id?: string
          created_at?: string
          grant_id?: string
          id?: string
          invoice_email_request_id?: string | null
          invoice_id?: string
          invoice_payload_hash?: string | null
          recipient?: string
          source_hash?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_delivery_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_delivery_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_delivery_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "payment_delivery_requests_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "payment_collection_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_delivery_requests_invoice_email_request_id_fkey"
            columns: ["invoice_email_request_id"]
            isOneToOne: false
            referencedRelation: "invoice_email_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_delivery_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_links: {
        Row: {
          amount_cents: number
          client_id: string
          conversation_id: string | null
          created_at: string
          description: string
          expires_at: string | null
          external_payment_id: string | null
          id: string
          paid_at: string | null
          payment_url: string | null
          provider: string
          status: string
        }
        Insert: {
          amount_cents: number
          client_id: string
          conversation_id?: string | null
          created_at?: string
          description: string
          expires_at?: string | null
          external_payment_id?: string | null
          id?: string
          paid_at?: string | null
          payment_url?: string | null
          provider?: string
          status?: string
        }
        Update: {
          amount_cents?: number
          client_id?: string
          conversation_id?: string | null
          created_at?: string
          description?: string
          expires_at?: string | null
          external_payment_id?: string | null
          id?: string
          paid_at?: string | null
          payment_url?: string | null
          provider?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_links_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_links_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
        ]
      }
      payment_provider_profiles: {
        Row: {
          account_id: string
          created_at: string
          livemode: boolean
          return_origin: string
          singleton: boolean
        }
        Insert: {
          account_id: string
          created_at?: string
          livemode: boolean
          return_origin: string
          singleton?: boolean
        }
        Update: {
          account_id?: string
          created_at?: string
          livemode?: boolean
          return_origin?: string
          singleton?: boolean
        }
        Relationships: []
      }
      payment_reconciliation_captures: {
        Row: {
          case_id: string
          created_at: string
          evidence: NonNullable<Json>
          proof_hash: string
          provider_observed_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          evidence: NonNullable<Json>
          proof_hash: string
          provider_observed_at: string
        }
        Update: {
          case_id?: string
          created_at?: string
          evidence?: NonNullable<Json>
          proof_hash?: string
          provider_observed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconciliation_captures_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "payment_reconciliation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reconciliation_cases: {
        Row: {
          actor_id: string
          blocker_refs: NonNullable<Json>
          created_at: string
          family: string
          id: string
          invoice_id: string
          provider_object_id: string
          request_id: string
          snapshot_hash: string
        }
        Insert: {
          actor_id: string
          blocker_refs: NonNullable<Json>
          created_at?: string
          family: string
          id: string
          invoice_id: string
          provider_object_id: string
          request_id: string
          snapshot_hash: string
        }
        Update: {
          actor_id?: string
          blocker_refs?: NonNullable<Json>
          created_at?: string
          family?: string
          id?: string
          invoice_id?: string
          provider_object_id?: string
          request_id?: string
          snapshot_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconciliation_cases_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reconciliation_observations: {
        Row: {
          created_at: string
          family: string
          id: string
          invoice_id: string
          reason: string
          request_id: string
        }
        Insert: {
          created_at?: string
          family: string
          id?: string
          invoice_id: string
          reason: string
          request_id: string
        }
        Update: {
          created_at?: string
          family?: string
          id?: string
          invoice_id?: string
          reason?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconciliation_observations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "billing_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reconciliation_resolutions: {
        Row: {
          actor_id: string
          case_id: string
          created_at: string
          ledger_evidence_id: string
          proof_hash: string
        }
        Insert: {
          actor_id: string
          case_id: string
          created_at?: string
          ledger_evidence_id: string
          proof_hash: string
        }
        Update: {
          actor_id?: string
          case_id?: string
          created_at?: string
          ledger_evidence_id?: string
          proof_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconciliation_resolutions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "payment_reconciliation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reconciliation_resolved_blockers: {
        Row: {
          blocker_id: string
          case_id: string
          kind: string
        }
        Insert: {
          blocker_id: string
          case_id: string
          kind: string
        }
        Update: {
          blocker_id?: string
          case_id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconciliation_resolved_blockers_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "payment_reconciliation_resolutions"
            referencedColumns: ["case_id"]
          },
        ]
      }
      pet_vaccinations: {
        Row: {
          administered_at: string
          administered_by: string | null
          created_at: string
          id: string
          lot_number: string | null
          next_due_at: string | null
          notes: string | null
          pet_id: string
          updated_at: string
          vaccine_name: string
        }
        Insert: {
          administered_at: string
          administered_by?: string | null
          created_at?: string
          id?: string
          lot_number?: string | null
          next_due_at?: string | null
          notes?: string | null
          pet_id: string
          updated_at?: string
          vaccine_name: string
        }
        Update: {
          administered_at?: string
          administered_by?: string | null
          created_at?: string
          id?: string
          lot_number?: string | null
          next_due_at?: string | null
          notes?: string | null
          pet_id?: string
          updated_at?: string
          vaccine_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_vaccinations_administered_by_fkey"
            columns: ["administered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_vaccinations_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pets: {
        Row: {
          allergies: string | null
          archived_at: string | null
          birth_date_precision: string
          breed: string | null
          client_id: string
          color: string | null
          created_at: string
          deceased_at: string | null
          dob: string | null
          id: string
          last_visit_at: string | null
          medications: string | null
          microchip_id: string | null
          name: string
          neuter_status: string
          sex: string
          species: string
          vaccination_notes: string | null
          version: number
          weight_lbs: number | null
        }
        Insert: {
          allergies?: string | null
          archived_at?: string | null
          birth_date_precision?: string
          breed?: string | null
          client_id: string
          color?: string | null
          created_at?: string
          deceased_at?: string | null
          dob?: string | null
          id?: string
          last_visit_at?: string | null
          medications?: string | null
          microchip_id?: string | null
          name: string
          neuter_status?: string
          sex?: string
          species: string
          vaccination_notes?: string | null
          version?: number
          weight_lbs?: number | null
        }
        Update: {
          allergies?: string | null
          archived_at?: string | null
          birth_date_precision?: string
          breed?: string | null
          client_id?: string
          color?: string | null
          created_at?: string
          deceased_at?: string | null
          dob?: string | null
          id?: string
          last_visit_at?: string | null
          medications?: string | null
          microchip_id?: string | null
          name?: string
          neuter_status?: string
          sex?: string
          species?: string
          vaccination_notes?: string | null
          version?: number
          weight_lbs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email_signature: string | null
          first_name: string
          full_name: string
          id: string
          is_active: boolean
          is_on_duty: boolean
          last_name: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email_signature?: string | null
          first_name?: string
          full_name?: string
          id: string
          is_active?: boolean
          is_on_duty?: boolean
          last_name?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email_signature?: string | null
          first_name?: string
          full_name?: string
          id?: string
          is_active?: boolean
          is_on_duty?: boolean
          last_name?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      qol_scale_reference_settings: {
        Row: {
          enabled: boolean
          id: string
          reference_label: string
          reference_total: number | null
          review_note: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          enabled?: boolean
          id?: string
          reference_label?: string
          reference_total?: number | null
          review_note?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          enabled?: boolean
          id?: string
          reference_label?: string
          reference_total?: number | null
          review_note?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      record_release_events: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          reason: string
          release_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id: string
          kind: string
          reason: string
          release_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          reason?: string
          release_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "record_release_events_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "record_releases"
            referencedColumns: ["id"]
          },
        ]
      }
      record_release_policy: {
        Row: {
          acceptance_reference: string
          accepted_at: string
          accepted_by: string
          accepted_schema_version: number
          enabled: boolean
          id: boolean
        }
        Insert: {
          acceptance_reference: string
          accepted_at: string
          accepted_by: string
          accepted_schema_version?: number
          enabled?: boolean
          id?: boolean
        }
        Update: {
          acceptance_reference?: string
          accepted_at?: string
          accepted_by?: string
          accepted_schema_version?: number
          enabled?: boolean
          id?: boolean
        }
        Relationships: []
      }
      record_release_sources: {
        Row: {
          id: string
          release_id: string
          source_id: string
          source_kind: string
        }
        Insert: {
          id?: string
          release_id: string
          source_id: string
          source_kind: string
        }
        Update: {
          id?: string
          release_id?: string
          source_id?: string
          source_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "record_release_sources_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "record_releases"
            referencedColumns: ["id"]
          },
        ]
      }
      record_releases: {
        Row: {
          channel: string
          client_id: string
          created_at: string
          created_by: string
          id: string
          pet_id: string
          recipient: string
          request: NonNullable<Json>
          selection: NonNullable<Json>
          snapshot: NonNullable<Json>
          source_hash: string
        }
        Insert: {
          channel: string
          client_id: string
          created_at?: string
          created_by: string
          id: string
          pet_id: string
          recipient: string
          request: NonNullable<Json>
          selection: NonNullable<Json>
          snapshot: NonNullable<Json>
          source_hash: string
        }
        Update: {
          channel?: string
          client_id?: string
          created_at?: string
          created_by?: string
          id?: string
          pet_id?: string
          recipient?: string
          request?: NonNullable<Json>
          selection?: NonNullable<Json>
          snapshot?: NonNullable<Json>
          source_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "record_releases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_releases_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      refill_requests: {
        Row: {
          approved_at: string | null
          assigned_to_id: string | null
          client_id: string
          conversation_id: string | null
          created_at: string
          id: string
          medication_name: string | null
          notes: string | null
          original_message: string | null
          pet_id: string | null
          picked_up_at: string | null
          ready_at: string | null
          requested_at: string
          status: Database["public"]["Enums"]["refill_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          assigned_to_id?: string | null
          client_id: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          medication_name?: string | null
          notes?: string | null
          original_message?: string | null
          pet_id?: string | null
          picked_up_at?: string | null
          ready_at?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["refill_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          assigned_to_id?: string | null
          client_id?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          medication_name?: string | null
          notes?: string | null
          original_message?: string | null
          pet_id?: string | null
          picked_up_at?: string | null
          ready_at?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["refill_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refill_requests_assigned_to_id_fkey"
            columns: ["assigned_to_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refill_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refill_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refill_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "refill_requests_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      release_email_outbox_links: {
        Row: {
          outbox_id: string
          queued_at: string
          queued_by: string
          request_id: string
          reviewed_payload_hash: string
        }
        Insert: {
          outbox_id: string
          queued_at?: string
          queued_by: string
          request_id: string
          reviewed_payload_hash: string
        }
        Update: {
          outbox_id?: string
          queued_at?: string
          queued_by?: string
          request_id?: string
          reviewed_payload_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_email_outbox_links_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: true
            referencedRelation: "communication_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_email_outbox_links_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "release_email_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      release_email_payloads: {
        Row: {
          captured_at: string
          manifest: NonNullable<Json>
          payload_hash: string
          payload_text: string | null
          purged_at: string | null
          request_id: string
        }
        Insert: {
          captured_at?: string
          manifest: NonNullable<Json>
          payload_hash: string
          payload_text?: string | null
          purged_at?: string | null
          request_id: string
        }
        Update: {
          captured_at?: string
          manifest?: NonNullable<Json>
          payload_hash?: string
          payload_text?: string | null
          purged_at?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_email_payloads_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "release_email_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      release_email_requests: {
        Row: {
          actor_id: string
          body: string
          client_id: string
          conversation_id: string
          created_at: string
          id: string
          recipient: string
          release_hash: string
          release_id: string
          state: string
          subject: string
        }
        Insert: {
          actor_id: string
          body: string
          client_id: string
          conversation_id: string
          created_at?: string
          id: string
          recipient: string
          release_hash: string
          release_id: string
          state?: string
          subject: string
        }
        Update: {
          actor_id?: string
          body?: string
          client_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          recipient?: string
          release_hash?: string
          release_id?: string
          state?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_email_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_email_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_email_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "release_email_requests_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "record_releases"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_automation_policies: {
        Row: {
          approved_at: string
          approved_by: string
          channel: string
          enabled: boolean
          id: string
          message_template_id: string
          message_template_version: number
          review_note: string
          source_kind: string
          subject: string
          version: number
        }
        Insert: {
          approved_at?: string
          approved_by: string
          channel: string
          enabled?: boolean
          id: string
          message_template_id: string
          message_template_version: number
          review_note: string
          source_kind: string
          subject?: string
          version?: number
        }
        Update: {
          approved_at?: string
          approved_by?: string
          channel?: string
          enabled?: boolean
          id?: string
          message_template_id?: string
          message_template_version?: number
          review_note?: string
          source_kind?: string
          subject?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "reminder_automation_policies_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_automation_policies_message_template_id_fkey"
            columns: ["message_template_id"]
            isOneToOne: false
            referencedRelation: "care_message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_automation_policy_history: {
        Row: {
          id: number
          policy_id: string
          snapshot: NonNullable<Json>
          version: number
        }
        Insert: {
          id?: never
          policy_id: string
          snapshot: NonNullable<Json>
          version: number
        }
        Update: {
          id?: never
          policy_id?: string
          snapshot?: NonNullable<Json>
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "reminder_automation_policy_history_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "reminder_automation_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_outbox_links: {
        Row: {
          approving_actor_id: string | null
          created_at: string
          frozen_context: Json | null
          invalidated_at: string | null
          job_id: string
          job_kind: string
          outbox_id: string | null
          policy_id: string
          policy_version: number
          reason: string | null
          state: string
        }
        Insert: {
          approving_actor_id?: string | null
          created_at?: string
          frozen_context?: Json | null
          invalidated_at?: string | null
          job_id: string
          job_kind: string
          outbox_id?: string | null
          policy_id: string
          policy_version: number
          reason?: string | null
          state: string
        }
        Update: {
          approving_actor_id?: string | null
          created_at?: string
          frozen_context?: Json | null
          invalidated_at?: string | null
          job_id?: string
          job_kind?: string
          outbox_id?: string | null
          policy_id?: string
          policy_version?: number
          reason?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_outbox_links_approving_actor_id_fkey"
            columns: ["approving_actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_outbox_links_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: true
            referencedRelation: "communication_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_outbox_links_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "reminder_automation_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_scheduler_results: {
        Row: {
          blocked: number | null
          failure_code: string | null
          finished_at: string
          outcome: string
          queued: number | null
          run_id: string
          skipped: number | null
        }
        Insert: {
          blocked?: number | null
          failure_code?: string | null
          finished_at?: string
          outcome: string
          queued?: number | null
          run_id: string
          skipped?: number | null
        }
        Update: {
          blocked?: number | null
          failure_code?: string | null
          finished_at?: string
          outcome?: string
          queued?: number | null
          run_id?: string
          skipped?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_scheduler_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "reminder_scheduler_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      reminder_scheduler_runs: {
        Row: {
          requested_limit: number
          run_id: string
          started_at: string
        }
        Insert: {
          requested_limit: number
          run_id: string
          started_at?: string
        }
        Update: {
          requested_limit?: number
          run_id?: string
          started_at?: string
        }
        Relationships: []
      }
      response_metrics: {
        Row: {
          channel: Database["public"]["Enums"]["message_type"]
          client_message_at: string
          conversation_id: string | null
          created_at: string | null
          id: string
          message_id: string | null
          response_time_seconds: number | null
          staff_id: string
          staff_reply_at: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["message_type"]
          client_message_at: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          message_id?: string | null
          response_time_seconds?: never
          staff_id: string
          staff_reply_at: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["message_type"]
          client_message_at?: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          message_id?: string | null
          response_time_seconds?: never
          staff_id?: string
          staff_reply_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "response_metrics_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "response_metrics_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "response_metrics_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["latest_message_id"]
          },
          {
            foreignKeyName: "response_metrics_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduler_job_results: {
        Row: {
          error_message: string | null
          outcome: string
          recorded_at: string
          run_id: string
          status_code: number | null
        }
        Insert: {
          error_message?: string | null
          outcome: string
          recorded_at?: string
          run_id: string
          status_code?: number | null
        }
        Update: {
          error_message?: string | null
          outcome?: string
          recorded_at?: string
          run_id?: string
          status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduler_job_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "scheduler_job_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduler_job_runs: {
        Row: {
          id: string
          job: string
          request_id: number | null
          requested_at: string
          url_path: string
        }
        Insert: {
          id?: string
          job: string
          request_id?: number | null
          requested_at?: string
          url_path: string
        }
        Update: {
          id?: string
          job?: string
          request_id?: number | null
          requested_at?: string
          url_path?: string
        }
        Relationships: []
      }
      sms_consent: {
        Row: {
          client_id: string
          consent_details: string | null
          consent_method: Database["public"]["Enums"]["consent_method"] | null
          created_at: string
          id: string
          opted_in: boolean
          opted_in_at: string | null
          opted_out_at: string | null
          phone_number: string
          updated_at: string
        }
        Insert: {
          client_id: string
          consent_details?: string | null
          consent_method?: Database["public"]["Enums"]["consent_method"] | null
          created_at?: string
          id?: string
          opted_in?: boolean
          opted_in_at?: string | null
          opted_out_at?: string | null
          phone_number: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          consent_details?: string | null
          consent_method?: Database["public"]["Enums"]["consent_method"] | null
          created_at?: string
          id?: string
          opted_in?: boolean
          opted_in_at?: string | null
          opted_out_at?: string | null
          phone_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_consent_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_suppression_events: {
        Row: {
          action: string
          actor_id: string | null
          client_id: string | null
          created_at: string
          id: string
          keyword: string | null
          note: string | null
          occurred_at: string
          provider: string | null
          provider_message_id: string | null
          recipient: string
          source: string
          suppressed_at: string | null
          suppression_reason: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          keyword?: string | null
          note?: string | null
          occurred_at: string
          provider?: string | null
          provider_message_id?: string | null
          recipient: string
          source: string
          suppressed_at?: string | null
          suppression_reason: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          keyword?: string | null
          note?: string | null
          occurred_at?: string
          provider?: string | null
          provider_message_id?: string | null
          recipient?: string
          source?: string
          suppressed_at?: string | null
          suppression_reason?: string
        }
        Relationships: []
      }
      stripe_event_receipts: {
        Row: {
          account_id: string
          created_at: string
          disposition: string
          event_id: string
          event_type: string
          id: string
          livemode: boolean
          object_id: string | null
          provider_created_at: number
          raw_sha256: string
          reason: string
          received_disposition: string
          received_reason: string
          request_id: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          disposition: string
          event_id: string
          event_type: string
          id?: string
          livemode: boolean
          object_id?: string | null
          provider_created_at: number
          raw_sha256: string
          reason: string
          received_disposition: string
          received_reason: string
          request_id?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          disposition?: string
          event_id?: string
          event_type?: string
          id?: string
          livemode?: boolean
          object_id?: string | null
          provider_created_at?: number
          raw_sha256?: string
          reason?: string
          received_disposition?: string
          received_reason?: string
          request_id?: string | null
        }
        Relationships: []
      }
      stripe_event_retry_cycles: {
        Row: {
          actor_id: string
          created_at: string
          cycle_no: number
          expected_work_hash: string
          id: string
          previous_attempt_count: number
          previous_cycle_attempt_count: number
          reason: string
          receipt_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          cycle_no: number
          expected_work_hash: string
          id: string
          previous_attempt_count: number
          previous_cycle_attempt_count: number
          reason: string
          receipt_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          cycle_no?: number
          expected_work_hash?: string
          id?: string
          previous_attempt_count?: number
          previous_cycle_attempt_count?: number
          reason?: string
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_event_retry_cycles_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "stripe_event_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_event_work: {
        Row: {
          attempt_count: number
          available_at: string
          cycle_attempt_count: number
          cycle_no: number
          lease_expires_at: string | null
          lease_token: string | null
          reason: string
          receipt_id: string
          state: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          cycle_attempt_count?: number
          cycle_no?: number
          lease_expires_at?: string | null
          lease_token?: string | null
          reason?: string
          receipt_id: string
          state: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          cycle_attempt_count?: number
          cycle_no?: number
          lease_expires_at?: string | null
          lease_token?: string | null
          reason?: string
          receipt_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_event_work_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "stripe_event_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_event_work_history: {
        Row: {
          action: string
          attempt_count: number
          created_at: string
          cycle_attempt_count: number | null
          cycle_no: number
          id: string
          lease_token: string | null
          reason: string
          receipt_id: string
        }
        Insert: {
          action: string
          attempt_count: number
          created_at?: string
          cycle_attempt_count?: number | null
          cycle_no?: number
          id?: string
          lease_token?: string | null
          reason: string
          receipt_id: string
        }
        Update: {
          action?: string
          attempt_count?: number
          created_at?: string
          cycle_attempt_count?: number | null
          cycle_no?: number
          id?: string
          lease_token?: string | null
          reason?: string
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_event_work_history_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "stripe_event_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          client_id: string
          comment: string | null
          created_at: string
          id: string
          responded_at: string | null
          score: number | null
          sent_at: string | null
          status: Database["public"]["Enums"]["survey_status"]
          survey_id: string
          ticket_id: string | null
        }
        Insert: {
          client_id: string
          comment?: string | null
          created_at?: string
          id?: string
          responded_at?: string | null
          score?: number | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["survey_status"]
          survey_id: string
          ticket_id?: string | null
        }
        Update: {
          client_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          responded_at?: string | null
          score?: number | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["survey_status"]
          survey_id?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      surveys: {
        Row: {
          created_at: string
          delay_hours: number
          id: string
          is_active: boolean
          name: string
          question: string
          survey_type: Database["public"]["Enums"]["survey_type"]
          trigger_on_ticket_close: boolean
        }
        Insert: {
          created_at?: string
          delay_hours?: number
          id?: string
          is_active?: boolean
          name: string
          question?: string
          survey_type?: Database["public"]["Enums"]["survey_type"]
          trigger_on_ticket_close?: boolean
        }
        Update: {
          created_at?: string
          delay_hours?: number
          id?: string
          is_active?: boolean
          name?: string
          question?: string
          survey_type?: Database["public"]["Enums"]["survey_type"]
          trigger_on_ticket_close?: boolean
        }
        Relationships: []
      }
      tickets: {
        Row: {
          assigned_to_id: string | null
          client_contact: string
          client_name: string
          confirm_with_jane: boolean
          consent_form_sent: boolean
          conversation_id: string | null
          created_at: string
          destination_country: string | null
          dob_age: string | null
          dvm_review_needed: boolean
          estimate_sent: boolean
          form_contract_sent: boolean
          form_type: Database["public"]["Enums"]["ticket_form_type"]
          health_cert_form_sent: boolean
          id: string
          new_client: boolean
          notes: string | null
          pet_name: string
          rdvm: string | null
          rdvm_records_requested: boolean
          sex: Database["public"]["Enums"]["pet_sex"] | null
          species_breed: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          symptom_summary: string | null
          travel_date: string | null
          updated_at: string
          vaccine_status_reviewed: boolean
        }
        Insert: {
          assigned_to_id?: string | null
          client_contact: string
          client_name: string
          confirm_with_jane?: boolean
          consent_form_sent?: boolean
          conversation_id?: string | null
          created_at?: string
          destination_country?: string | null
          dob_age?: string | null
          dvm_review_needed?: boolean
          estimate_sent?: boolean
          form_contract_sent?: boolean
          form_type: Database["public"]["Enums"]["ticket_form_type"]
          health_cert_form_sent?: boolean
          id?: string
          new_client?: boolean
          notes?: string | null
          pet_name: string
          rdvm?: string | null
          rdvm_records_requested?: boolean
          sex?: Database["public"]["Enums"]["pet_sex"] | null
          species_breed?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          symptom_summary?: string | null
          travel_date?: string | null
          updated_at?: string
          vaccine_status_reviewed?: boolean
        }
        Update: {
          assigned_to_id?: string | null
          client_contact?: string
          client_name?: string
          confirm_with_jane?: boolean
          consent_form_sent?: boolean
          conversation_id?: string | null
          created_at?: string
          destination_country?: string | null
          dob_age?: string | null
          dvm_review_needed?: boolean
          estimate_sent?: boolean
          form_contract_sent?: boolean
          form_type?: Database["public"]["Enums"]["ticket_form_type"]
          health_cert_form_sent?: boolean
          id?: string
          new_client?: boolean
          notes?: string | null
          pet_name?: string
          rdvm?: string | null
          rdvm_records_requested?: boolean
          sex?: Database["public"]["Enums"]["pet_sex"] | null
          species_breed?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          symptom_summary?: string | null
          travel_date?: string | null
          updated_at?: string
          vaccine_status_reviewed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tickets_assigned_to_id_fkey"
            columns: ["assigned_to_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_workspace_rows"
            referencedColumns: ["conversation_id"]
          },
        ]
      }
      time_entries: {
        Row: {
          clock_in_at: string
          clock_out_at: string | null
          created_at: string
          id: string
          note: string | null
          staff_id: string
        }
        Insert: {
          clock_in_at?: string
          clock_out_at?: string | null
          created_at?: string
          id?: string
          note?: string | null
          staff_id: string
        }
        Update: {
          clock_in_at?: string
          clock_out_at?: string | null
          created_at?: string
          id?: string
          note?: string | null
          staff_id?: string
        }
        Relationships: []
      }
      treatment_alert_reviews: {
        Row: {
          id: string
          pet_id: string
          reviewed_at: string
          reviewed_by: string
          snapshot: NonNullable<Json>
          source_hash: string
          treatment_id: string
        }
        Insert: {
          id?: string
          pet_id: string
          reviewed_at?: string
          reviewed_by: string
          snapshot: NonNullable<Json>
          source_hash: string
          treatment_id: string
        }
        Update: {
          id?: string
          pet_id?: string
          reviewed_at?: string
          reviewed_by?: string
          snapshot?: NonNullable<Json>
          source_hash?: string
          treatment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatment_alert_reviews_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_alert_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_alert_reviews_treatment_id_fkey"
            columns: ["treatment_id"]
            isOneToOne: true
            referencedRelation: "patient_treatments"
            referencedColumns: ["id"]
          },
        ]
      }
      urgent_alerts: {
        Row: {
          alert_type: string
          campaign_id: string | null
          created_at: string
          id: string
          message: string
          recipient_count: number
          sent_by: string | null
        }
        Insert: {
          alert_type: string
          campaign_id?: string | null
          created_at?: string
          id?: string
          message: string
          recipient_count?: number
          sent_by?: string | null
        }
        Update: {
          alert_type?: string
          campaign_id?: string | null
          created_at?: string
          id?: string
          message?: string
          recipient_count?: number
          sent_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: []
      }
      vaccine_certificate_events: {
        Row: {
          certificate_id: string
          created_at: string
          created_by: string
          id: string
          kind: string
          reason: string
          replacement_id: string | null
        }
        Insert: {
          certificate_id: string
          created_at?: string
          created_by: string
          id: string
          kind: string
          reason: string
          replacement_id?: string | null
        }
        Update: {
          certificate_id?: string
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          reason?: string
          replacement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vaccine_certificate_events_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: false
            referencedRelation: "vaccine_certificates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccine_certificate_events_replacement_id_fkey"
            columns: ["replacement_id"]
            isOneToOne: false
            referencedRelation: "vaccine_certificates"
            referencedColumns: ["id"]
          },
        ]
      }
      vaccine_certificate_treatments: {
        Row: {
          certificate_id: string
          id: string
          treatment_id: string
        }
        Insert: {
          certificate_id: string
          id?: string
          treatment_id: string
        }
        Update: {
          certificate_id?: string
          id?: string
          treatment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vaccine_certificate_treatments_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: false
            referencedRelation: "vaccine_certificates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccine_certificate_treatments_treatment_id_fkey"
            columns: ["treatment_id"]
            isOneToOne: false
            referencedRelation: "patient_treatments"
            referencedColumns: ["id"]
          },
        ]
      }
      vaccine_certificates: {
        Row: {
          attestation: string
          id: string
          issued_at: string
          issued_by: string
          kind: string
          pet_id: string
          replaces_id: string | null
          request: NonNullable<Json>
          signature_name: string
          snapshot: NonNullable<Json>
        }
        Insert: {
          attestation: string
          id: string
          issued_at?: string
          issued_by: string
          kind: string
          pet_id: string
          replaces_id?: string | null
          request: NonNullable<Json>
          signature_name: string
          snapshot: NonNullable<Json>
        }
        Update: {
          attestation?: string
          id?: string
          issued_at?: string
          issued_by?: string
          kind?: string
          pet_id?: string
          replaces_id?: string | null
          request?: NonNullable<Json>
          signature_name?: string
          snapshot?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "vaccine_certificates_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccine_certificates_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: false
            referencedRelation: "vaccine_certificates"
            referencedColumns: ["id"]
          },
        ]
      }
      vaccine_due_templates: {
        Row: {
          active: boolean
          group_key: string
          id: string
          interval_days: number
          name: string
          product_ids: string[]
          review_note: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          active?: boolean
          group_key: string
          id: string
          interval_days: number
          name: string
          product_ids: string[]
          review_note: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          active?: boolean
          group_key?: string
          id?: string
          interval_days?: number
          name?: string
          product_ids?: string[]
          review_note?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "vaccine_due_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      voicemail_messages: {
        Row: {
          ai_summary: string | null
          call_sid: string
          created_at: string
          from_number: string
          id: string
          is_read: boolean
          recording_duration: number | null
          recording_path: string | null
          recording_url: string | null
          status: string
          summary_generated_at: string | null
          to_number: string | null
          transcription: string | null
          transcription_status: string | null
        }
        Insert: {
          ai_summary?: string | null
          call_sid: string
          created_at?: string
          from_number: string
          id?: string
          is_read?: boolean
          recording_duration?: number | null
          recording_path?: string | null
          recording_url?: string | null
          status?: string
          summary_generated_at?: string | null
          to_number?: string | null
          transcription?: string | null
          transcription_status?: string | null
        }
        Update: {
          ai_summary?: string | null
          call_sid?: string
          created_at?: string
          from_number?: string
          id?: string
          is_read?: boolean
          recording_duration?: number | null
          recording_path?: string | null
          recording_url?: string | null
          status?: string
          summary_generated_at?: string | null
          to_number?: string | null
          transcription?: string | null
          transcription_status?: string | null
        }
        Relationships: []
      }
      waitlist_entries: {
        Row: {
          appointment_type: string
          client_id: string
          created_at: string
          id: string
          notes: string | null
          notified_at: string | null
          pet_id: string | null
          position: number
          preferred_date: string
          preferred_date_end: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["waitlist_status"]
        }
        Insert: {
          appointment_type: string
          client_id: string
          created_at?: string
          id?: string
          notes?: string | null
          notified_at?: string | null
          pet_id?: string | null
          position?: number
          preferred_date: string
          preferred_date_end?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["waitlist_status"]
        }
        Update: {
          appointment_type?: string
          client_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          notified_at?: string | null
          pet_id?: string | null
          position?: number
          preferred_date?: string
          preferred_date_end?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["waitlist_status"]
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      website_inquiry_history: {
        Row: {
          action: string
          actor_id: string
          after_value: Json | null
          before_value: Json | null
          created_at: string
          id: string
          inquiry_id: string
          reason: string
        }
        Insert: {
          action: string
          actor_id: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          id?: string
          inquiry_id: string
          reason: string
        }
        Update: {
          action?: string
          actor_id?: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          id?: string
          inquiry_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_inquiry_history_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "website_inquiry_triage"
            referencedColumns: ["inquiry_id"]
          },
        ]
      }
      website_inquiry_triage: {
        Row: {
          assigned_to_id: string | null
          client_id: string | null
          inquiry_id: string
          reply_channel: string | null
          reply_recipient: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          assigned_to_id?: string | null
          client_id?: string | null
          inquiry_id: string
          reply_channel?: string | null
          reply_recipient?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          assigned_to_id?: string | null
          client_id?: string | null
          inquiry_id?: string
          reply_channel?: string | null
          reply_recipient?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "website_inquiry_triage_assigned_to_id_fkey"
            columns: ["assigned_to_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_inquiry_triage_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_inquiry_triage_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: true
            referencedRelation: "contact_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      wellness_reminders: {
        Row: {
          channel: string
          client_id: string
          created_at: string
          id: string
          label: string
          last_sent_at: string | null
          next_due_at: string
          pet_id: string
          reminder_type: Database["public"]["Enums"]["wellness_reminder_type"]
          status: Database["public"]["Enums"]["wellness_reminder_status"]
          vaccination_id: string | null
        }
        Insert: {
          channel?: string
          client_id: string
          created_at?: string
          id?: string
          label: string
          last_sent_at?: string | null
          next_due_at: string
          pet_id: string
          reminder_type: Database["public"]["Enums"]["wellness_reminder_type"]
          status?: Database["public"]["Enums"]["wellness_reminder_status"]
          vaccination_id?: string | null
        }
        Update: {
          channel?: string
          client_id?: string
          created_at?: string
          id?: string
          label?: string
          last_sent_at?: string | null
          next_due_at?: string
          pet_id?: string
          reminder_type?: Database["public"]["Enums"]["wellness_reminder_type"]
          status?: Database["public"]["Enums"]["wellness_reminder_status"]
          vaccination_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wellness_reminders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellness_reminders_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellness_reminders_vaccination_id_fkey"
            columns: ["vaccination_id"]
            isOneToOne: false
            referencedRelation: "pet_vaccinations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      inbox_workspace_rows: {
        Row: {
          assigned_to_id: string | null
          client_id: string | null
          client_name: string | null
          conversation_id: string | null
          is_unread: boolean | null
          latest_content: string | null
          latest_message_id: string | null
          latest_type: Database["public"]["Enums"]["message_type"] | null
          primary_email: string | null
          primary_phone: string | null
          priority: Database["public"]["Enums"]["conversation_priority"] | null
          revision: number | null
          status: Database["public"]["Enums"]["conversation_status"] | null
          tags: string[] | null
          unread_count: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_to_id_fkey"
            columns: ["assigned_to_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      abandon_conversation_attachment: {
        Args: { p_id: string }
        Returns: {
          actor_id: string
          byte_length: number
          conversation_id: string
          created_at: string
          file_name: string
          id: string
          mime_type: string
          sha256: string | null
          status: string
          storage_path: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "conversation_attachment_uploads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      abandon_ezyvet_attachment_capture_preparation: {
        Args: {
          p_animal_link_id: string
          p_id: string
          p_observed_head_version: number
          p_ordinal: number
          p_page: number
          p_run_id: string
          p_snapshot_id: string
          p_stable_metadata_sha256: string
        }
        Returns: Json
      }
      abandon_ezyvet_history_request: {
        Args: {
          p_confirmed: boolean
          p_id: string
          p_kind: string
          p_pet_id: string
        }
        Returns: Json
      }
      abandon_ezyvet_prescription_review: {
        Args: { p_confirmed: boolean; p_id: string; p_pet_id: string }
        Returns: Json
      }
      abandon_ezyvet_vaccination_review: {
        Args: { p_confirmed: boolean; p_id: string; p_pet_id: string }
        Returns: Json
      }
      abandon_invoice_email: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      abandon_patient_document: {
        Args: { p_id: string }
        Returns: {
          category: string
          created_at: string
          created_by: string
          document_date: string | null
          encounter_id: string | null
          file_name: string
          file_path: string
          file_size: number
          finalized_at: string | null
          id: string
          mime_type: string
          pet_id: string
          source: string
          status: string
          version: number
          visibility: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "patient_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      abandon_release_email: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      abandoned_cleanup_lease: {
        Args: {
          p_row: Database["public"]["Tables"]["abandoned_attachment_cleanup"]["Row"]
          p_upload: Database["public"]["Tables"]["conversation_attachment_uploads"]["Row"]
        }
        Returns: Json
      }
      accept_contact_intake: {
        Args: {
          p_capability_hash: string
          p_email_budget_hash: string
          p_payload: Json
          p_request_id: string
        }
        Returns: Json
      }
      acknowledge_external_record: {
        Args: {
          p_attest: boolean
          p_expected_capture_hash: string
          p_expected_document_version: number
          p_id: string
          p_pet_id: string
          p_record_id: string
        }
        Returns: {
          actor_id: string
          capture_hash: string
          created_at: string
          document_version: number
          id: string
          record_id: string
        }
        SetofOptions: {
          from: "*"
          to: "external_record_acknowledgments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      acknowledge_lab_report: {
        Args: {
          p_attest: boolean
          p_expected_capture_hash: string
          p_expected_document_version: number
          p_id: string
          p_pet_id: string
          p_report_id: string
        }
        Returns: {
          actor_id: string
          capture_hash: string
          created_at: string
          document_version: number
          id: string
          report_id: string
        }
        SetofOptions: {
          from: "*"
          to: "lab_report_acknowledgments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      activate_payment_collection: {
        Args: {
          p_allow_create?: boolean
          p_collection_token_hash: string
          p_grant_id: string
          p_key_version: string
          p_origin: string
        }
        Returns: Json
      }
      add_anesthesia_record_addendum: {
        Args: {
          p_content: string
          p_id: string
          p_pet_id: string
          p_record_id: string
        }
        Returns: {
          actor_id: string
          content: string
          id: string
          record_id: string
          recorded_at: string
        }
        SetofOptions: {
          from: "*"
          to: "anesthesia_record_addenda"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_clinical_addendum: {
        Args: { p_content: string; p_encounter_id: string }
        Returns: {
          content: string
          created_at: string
          created_by: string
          encounter_id: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "clinical_addenda"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_dental_addendum: {
        Args: {
          p_chart_id: string
          p_content: string
          p_id: string
          p_pet_id: string
        }
        Returns: {
          chart_id: string
          content: string
          created_at: string
          created_by: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "dental_chart_addenda"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_invoice_service: {
        Args: {
          p_id: string
          p_invoice_id: string
          p_pet_id: string
          p_product_id: string
          p_quantity: number
        }
        Returns: {
          amount_cents: number | null
          created_at: string
          created_by: string
          description: string
          id: string
          invoice_id: string
          pet_id: string | null
          product_id: string
          quantity: number
          unit_price_cents: number
        }
        SetofOptions: {
          from: "*"
          to: "billing_invoice_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_patient_qol_addendum: {
        Args: { p_content: string; p_id: string; p_qol_id: string }
        Returns: {
          content: string
          created_at: string
          created_by: string
          id: string
          qol_id: string
        }
        SetofOptions: {
          from: "*"
          to: "patient_qol_addenda"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_patient_qol_scale_addendum: {
        Args: { p_assessment_id: string; p_content: string; p_id: string }
        Returns: {
          assessment_id: string
          content: string
          created_at: string
          created_by: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "patient_qol_scale_addenda"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      adjust_inventory: {
        Args: {
          p_id: string
          p_lot_id: string
          p_quantity: number
          p_reason: string
        }
        Returns: {
          created_at: string
          created_by: string
          id: string
          kind: string
          lot_id: string
          quantity: number
          reason: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_staff_active: {
        Args: { _is_active: boolean; _target_user: string }
        Returns: undefined
      }
      admin_update_staff_role: {
        Args: {
          _new_role: Database["public"]["Enums"]["user_role"]
          _target_user: string
        }
        Returns: undefined
      }
      anesthesia_validate: {
        Args: {
          p_record: Database["public"]["Tables"]["patient_anesthesia_records"]["Row"]
        }
        Returns: undefined
      }
      append_native_dispense_correction: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      apply_checkout_evidence: {
        Args: {
          p_account_id: string
          p_amount_cents: number
          p_currency: string
          p_event_id: string
          p_kind: string
          p_livemode: boolean
          p_payment_id: string
          p_request_id: string
          p_session_id: string
          p_source_hash: string
        }
        Returns: {
          account_id: string
          amount_cents: number | null
          created_at: string
          currency: string | null
          disposition: string
          event_id: string
          id: string
          kind: string
          livemode: boolean
          payment_id: string | null
          reason: string
          request_id: string
          session_id: string | null
          source_hash: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoice_payment_evidence"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_inbox_read_snapshot: {
        Args: { p_actor_id: string; p_snapshot_id: string }
        Returns: undefined
      }
      apply_refund_evidence: {
        Args: {
          p_account_id: string
          p_amount_cents: number
          p_currency: string
          p_event_id: string
          p_livemode: boolean
          p_provider_payment_id: string
          p_refund_id: string
          p_request_id: string
          p_status: string
        }
        Returns: {
          account_id: string
          amount_cents: number
          created_at: string
          currency: string
          disposition: string
          event_id: string
          id: string
          livemode: boolean
          provider_payment_id: string
          reason: string
          refund_id: string
          request_id: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_refund_evidence"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_retention_policies: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      appointment_reminder_channel: {
        Args: { p_client_id: string }
        Returns: string
      }
      appointment_require_staff: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      approve_external_record_import: {
        Args: {
          p_attest: boolean
          p_expected_capture_hash: string
          p_expected_receipt_hash: string
          p_id: string
          p_receipt_id: string
        }
        Returns: {
          actor_id: string
          animal_link_id: string
          capture_hash: string
          created_at: string
          document_id: string
          document_version: number
          export_reference: string
          id: string
          kind: string
          pet_id: string
          pet_version: number
          previous_record_id: string | null
          receipt_hash: string
          receipt_id: string
          review_reason: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "external_record_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_ezyvet_attachment_record: {
        Args: {
          p_attest: boolean
          p_capture_hash: string
          p_id: string
          p_pet_id: string
          p_previous_record_id: string
          p_request_id: string
          p_review_reason: string
          p_title: string
        }
        Returns: {
          actor_id: string
          animal_link_id: string
          attachment_external_id: string
          capture_hash: string
          created_at: string
          entry_method: string
          id: string
          pet_id: string
          previous_record_id: string | null
          record_hash: string
          request_hash: string
          request_id: string
          review_reason: string
          source_context: NonNullable<Json>
          source_origin: string
          source_site_uid: string
          title: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_attachment_record_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_ezyvet_attachment_record_uncancelled: {
        Args: {
          p_attest: boolean
          p_capture_hash: string
          p_id: string
          p_pet_id: string
          p_previous_record_id: string
          p_request_id: string
          p_review_reason: string
          p_title: string
        }
        Returns: {
          actor_id: string
          animal_link_id: string
          attachment_external_id: string
          capture_hash: string
          created_at: string
          entry_method: string
          id: string
          pet_id: string
          previous_record_id: string | null
          record_hash: string
          request_hash: string
          request_id: string
          review_reason: string
          source_context: NonNullable<Json>
          source_origin: string
          source_site_uid: string
          title: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_attachment_record_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_ezyvet_history: {
        Args: {
          p_confirmed: boolean
          p_expected_hash: string
          p_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      approve_ezyvet_history_discrepancy: {
        Args: {
          p_confirmed: boolean
          p_expected_hash: string
          p_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      approve_ezyvet_prescription_review: {
        Args: {
          p_confirmed: boolean
          p_expected_hash: string
          p_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      approve_ezyvet_problem_extraction: {
        Args: {
          p_confirmed: boolean
          p_expected_hash: string
          p_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      approve_ezyvet_vaccination_review: {
        Args: {
          p_confirmed: boolean
          p_expected_hash: string
          p_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      approve_ezyvet_weight: {
        Args: {
          p_action: string
          p_actor_id: string
          p_animal_link_id: string
          p_confirmed: boolean
          p_expected_hash: string
          p_head_version: number
          p_measured_at: string
          p_patient_version: number
          p_reason: string
          p_request_id: string
          p_snapshot_id: string
          p_unit: string
          p_weight: number
          p_weight_id: string
        }
        Returns: {
          action: string
          animal_link_id: string
          approved_by: string
          created_at: string
          external_id: string
          head_version: number
          patient_version: number
          pet_id: string
          reason: string
          request_hash: string
          request_id: string
          reviewed_values: NonNullable<Json>
          snapshot_id: string
          source_origin: string
          source_site_uid: string
          weight_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_weight_approvals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_inbound_communication: {
        Args: {
          p_actor_id: string
          p_client_id: string
          p_conversation_id: string
          p_expected_version: number
          p_id: string
          p_reason: string
        }
        Returns: {
          attachment_metadata: NonNullable<Json>
          body: string
          channel: string
          client_id: string | null
          conversation_id: string | null
          direction: string
          event_id: string | null
          html_body: string | null
          id: string
          message_id: string | null
          occurred_at: string
          provider: string
          received_at: string
          recipient: string
          reply_ids: string[]
          resource_id: string
          review_reason: string | null
          rfc_message_id: string | null
          sender: string
          subject: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "communication_inbound"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attest_document_link: {
        Args: {
          p_attest: boolean
          p_request_id: string
          p_reviewed_artifact_hash: string
          p_reviewed_message_hash: string
        }
        Returns: undefined
      }
      attest_payment_collection: {
        Args: {
          p_attest: boolean
          p_request_id: string
          p_reviewed_context_hash: string
        }
        Returns: Json
      }
      authorize_inbound_attachment_read: {
        Args: { p_actor_id: string; p_capture_id: string; p_message_id: string }
        Returns: Json
      }
      authorize_record_release: {
        Args: {
          p_channel: string
          p_client_id: string
          p_id: string
          p_recipient: string
        }
        Returns: Json
      }
      authorize_website_inquiry_reply: {
        Args: { p_actor_id: string; p_expected_version: number; p_id: string }
        Returns: Json
      }
      begin_discard_ezyvet_attachment_capture: {
        Args: { p_actor: string; p_id: string }
        Returns: Json
      }
      bind_ezyvet_migration_child: {
        Args: {
          p_child_run_id: string
          p_id: string
          p_reason: string
          p_replaces_id?: string
          p_scope_id: string
        }
        Returns: Json
      }
      block_reminder_job: {
        Args: { p_job_id: string; p_job_kind: string; p_reason: string }
        Returns: undefined
      }
      cancel_appointment: {
        Args: { p_expected_version: number; p_id: string }
        Returns: {
          address_snapshot: string
          appointment_type: string
          assigned_dvm_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          duration_minutes: number
          ezyvet_appointment_id: string | null
          id: string
          notes: string | null
          pet_id: string | null
          reminder_offsets: number[]
          resource_name: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          travel_after_minutes: number
          travel_before_minutes: number
          updated_at: string
          updated_by: string | null
          version: number
          visit_type: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_ezyvet_attachment_approval: {
        Args: {
          p_capture_hash: string
          p_confirmed: boolean
          p_id: string
          p_pet_id: string
          p_request_id: string
        }
        Returns: Json
      }
      cancel_native_prescription: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      cancel_outbound_delivery: {
        Args: {
          p_delivery_id: string
          p_expected_updated_at?: string
          p_requested_at?: string
        }
        Returns: {
          accepted_at: string | null
          appointment_reminder_id: string | null
          attempt_count: number
          canceled_at: string | null
          channel: Database["public"]["Enums"]["channel_type"]
          client_id: string | null
          conversation_id: string | null
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error_text: string | null
          lease_owner: string | null
          leased_at: string | null
          leased_until: string | null
          max_attempts: number
          message_id: string | null
          next_attempt_at: string
          payload: NonNullable<Json>
          provider: string | null
          provider_message_id: string | null
          recipient: string
          requested_by: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["outbound_delivery_status"]
          status_note: string | null
          unknown_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "outbound_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      capture_conversation_email: {
        Args: {
          p_actor_id: string
          p_payload_text: string
          p_request_id: string
        }
        Returns: undefined
      }
      capture_document_link: {
        Args: {
          p_actor_id: string
          p_id: string
          p_message_hash: string
          p_payload_text: string
          p_token_hash: string
        }
        Returns: undefined
      }
      capture_external_record_bytes: {
        Args: {
          p_actor_id: string
          p_content_sha256: string
          p_document_version: number
          p_expected_receipt_hash: string
          p_file_size: number
          p_mime_type: string
          p_receipt_id: string
        }
        Returns: {
          actor_id: string
          capture_hash: string
          captured_at: string
          content_sha256: string
          document_version: number
          file_size: number
          mime_type: string
          receipt_hash: string
          receipt_id: string
        }
        SetofOptions: {
          from: "*"
          to: "external_record_byte_captures"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      capture_inbox_read_snapshot: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      capture_invoice_email_payload: {
        Args: {
          p_actor_id: string
          p_payload_text: string
          p_request_id: string
        }
        Returns: undefined
      }
      capture_lab_report_bytes: {
        Args: {
          p_actor_id: string
          p_content_sha256: string
          p_document_version: number
          p_expected_receipt_hash: string
          p_file_size: number
          p_mime_type: string
          p_receipt_id: string
        }
        Returns: {
          actor_id: string
          capture_hash: string
          captured_at: string
          content_sha256: string
          document_version: number
          file_size: number
          mime_type: string
          receipt_hash: string
          receipt_id: string
        }
        SetofOptions: {
          from: "*"
          to: "lab_report_byte_captures"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      capture_native_estimate_decision_grant: {
        Args: {
          p_actor_id: string
          p_context_hash: string
          p_grant_id: string
          p_key_version: string
          p_origin: string
          p_token_hash: string
        }
        Returns: Json
      }
      capture_native_estimate_publication_artifact: {
        Args: {
          p_actor_id: string
          p_content_hash: string
          p_html_utf8_base64: string
          p_id: string
          p_renderer_version: number
        }
        Returns: Json
      }
      capture_payment_collection: {
        Args: {
          p_actor_id: string
          p_collection_token_hash: string
          p_key_version: string
          p_origin: string
          p_request_id: string
          p_status_token_hash: string
        }
        Returns: Json
      }
      capture_payment_delivery: {
        Args: {
          p_actor_id: string
          p_message_hash: string
          p_payload_hash: string
          p_request_id: string
          p_sender_config: Json
        }
        Returns: undefined
      }
      capture_payment_reconciliation: {
        Args: {
          p_case_id: string
          p_provider_evidence: Json
          p_reviewer_id: string
        }
        Returns: Json
      }
      capture_release_email_payload: {
        Args: {
          p_actor_id: string
          p_payload_text: string
          p_request_id: string
        }
        Returns: undefined
      }
      care_require_admin: { Args: Record<PropertyKey, never>; Returns: string }
      certificate_require_issuer: {
        Args: Record<PropertyKey, never>
        Returns: {
          active: boolean
          clinical_acceptance_at: string
          full_name: string
          id: string
          license_expires_on: string
          license_number: string
          license_state: string
          practice_address: string
          practice_name: string
          practice_phone: string
          user_id: string
          verification_reference: string
          verified_at: string
        }
        SetofOptions: {
          from: "*"
          to: "certificate_issuers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      checkout_payment_context: {
        Args: { p_actor_id: string; p_request_id: string }
        Returns: Json
      }
      checkout_state_internal: {
        Args: { p_request_id: string }
        Returns: string
      }
      claim_abandoned_attachment_cleanup: {
        Args: { p_grace_hours: number; p_upload_id: string }
        Returns: Json
      }
      claim_communication: {
        Args: Record<PropertyKey, never>
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_communication_event: {
        Args: Record<PropertyKey, never>
        Returns: {
          attempts: number
          available_at: string
          cycle_attempts: number
          cycle_no: number
          event_id: string
          event_type: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          metadata: NonNullable<Json>
          payload_hash: string
          provider: string
          received_at: string
          resource_id: string
          revision: number
          state: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_provider_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_due_outbound_deliveries: {
        Args: {
          p_batch_size?: number
          p_claimed_at?: string
          p_lease_duration?: string
          p_lease_owner: string
        }
        Returns: {
          accepted_at: string | null
          appointment_reminder_id: string | null
          attempt_count: number
          canceled_at: string | null
          channel: Database["public"]["Enums"]["channel_type"]
          client_id: string | null
          conversation_id: string | null
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error_text: string | null
          lease_owner: string | null
          leased_at: string | null
          leased_until: string | null
          max_attempts: number
          message_id: string | null
          next_attempt_at: string
          payload: NonNullable<Json>
          provider: string | null
          provider_message_id: string | null
          recipient: string
          requested_by: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["outbound_delivery_status"]
          status_note: string | null
          unknown_at: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "outbound_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_ezyvet_attachment_capture: {
        Args: { p_actor: string; p_id: string }
        Returns: Json
      }
      claim_ezyvet_attachment_import: {
        Args: {
          p_actor: string
          p_animal_link_id: string
          p_id: string
          p_site_uid: string
          p_source_origin: string
        }
        Returns: Json
      }
      claim_ezyvet_clinical_import: {
        Args: {
          p_actor: string
          p_animal_link_id: string
          p_id: string
          p_resource: string
          p_site_uid: string
          p_source_origin: string
        }
        Returns: Json
      }
      claim_ezyvet_import: {
        Args: {
          p_actor: string
          p_id: string
          p_resource: string
          p_site_uid: string
          p_source_origin: string
        }
        Returns: {
          created_at: string
          id: string
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          next_page: number
          requested_by: string
          resource: string
          retry_after: string | null
          source_origin: string
          source_site_uid: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_ezyvet_import_core: {
        Args: {
          p_actor: string
          p_id: string
          p_resource: string
          p_site_uid: string
          p_source_origin: string
        }
        Returns: {
          created_at: string
          id: string
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          next_page: number
          requested_by: string
          resource: string
          retry_after: string | null
          source_origin: string
          source_site_uid: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_ezyvet_prescription_import: {
        Args: {
          p_actor: string
          p_animal_link_id: string
          p_id: string
          p_resource: string
          p_site_uid: string
          p_source_origin: string
        }
        Returns: Json
      }
      claim_ezyvet_prescriptionitem_import: {
        Args: {
          p_actor: string
          p_animal_link_id: string
          p_id: string
          p_prescription_observed_head_version: number
          p_prescription_payload_hash: string
          p_prescription_snapshot_id: string
          p_resource: string
          p_site_uid: string
          p_source_origin: string
        }
        Returns: Json
      }
      claim_ezyvet_vaccination_import: {
        Args: {
          p_actor: string
          p_animal_link_id: string
          p_consult_observed_head_version: number
          p_consult_payload_hash: string
          p_consult_snapshot_id: string
          p_id: string
          p_resource: string
          p_site_uid: string
          p_source_origin: string
        }
        Returns: Json
      }
      claim_ezyvet_weight_import: {
        Args: {
          p_actor: string
          p_animal_link_id: string
          p_id: string
          p_site_uid: string
          p_source_origin: string
        }
        Returns: Json
      }
      claim_inbound_attachment: {
        Args: {
          p_actor_id: string
          p_attachment_id: string
          p_inbound_id: string
          p_version: number
        }
        Returns: Json
      }
      claim_stripe_event: { Args: Record<PropertyKey, never>; Returns: Json }
      clinical_require_staff: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      clock_in: {
        Args: Record<PropertyKey, never>
        Returns: {
          clock_in_at: string
          clock_out_at: string | null
          created_at: string
          id: string
          note: string | null
          staff_id: string
        }
        SetofOptions: {
          from: "*"
          to: "time_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clock_out: {
        Args: Record<PropertyKey, never>
        Returns: {
          clock_in_at: string
          clock_out_at: string | null
          created_at: string
          id: string
          note: string | null
          staff_id: string
        }
        SetofOptions: {
          from: "*"
          to: "time_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_native_dispense_finance: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      close_native_estimate_client_decision: {
        Args: {
          p_id: string
          p_key_version: string
          p_origin: string
          p_request: Json
          p_token_hash: string
        }
        Returns: Json
      }
      close_native_estimate_decision_grant: {
        Args: { p_id: string; p_mutation: Json }
        Returns: Json
      }
      close_native_estimate_draft: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      close_native_estimate_publication_operation: {
        Args: { p_id: string; p_mutation: Json }
        Returns: Json
      }
      close_native_estimate_witnessed_decision: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      close_native_fill_slot: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      cloudtalk_app_send_text: { Args: { p_body: string }; Returns: string }
      cloudtalk_duration_text: { Args: { p_seconds: number }; Returns: string }
      communication_is_suppressed: {
        Args: { p_channel: string; p_client_id: string; p_recipient: string }
        Returns: boolean
      }
      communication_processing_projection: {
        Args: {
          p_event: Database["public"]["Tables"]["communication_provider_events"]["Row"]
        }
        Returns: Json
      }
      communication_recipient: {
        Args: { p_channel: string; p_recipient: string }
        Returns: string
      }
      communication_require_service: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      communication_retry_eligible: {
        Args: {
          p_event: Database["public"]["Tables"]["communication_provider_events"]["Row"]
        }
        Returns: boolean
      }
      communication_retry_hash: {
        Args: {
          p_event: Database["public"]["Tables"]["communication_provider_events"]["Row"]
        }
        Returns: string
      }
      communication_sms_provider: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      complete_communication_status: {
        Args: { p_event_id: string; p_lease_token: string }
        Returns: undefined
      }
      complete_discard_ezyvet_attachment_capture: {
        Args: { p_actor: string; p_id: string }
        Returns: Json
      }
      complete_ezyvet_attachment_capture: {
        Args: {
          p_actor: string
          p_content_sha256: string
          p_file_size: number
          p_id: string
          p_intent_id: string
          p_lease_id: string
          p_mime_type: string
        }
        Returns: Json
      }
      complete_inbound_communication: {
        Args: {
          p_attachments: Json
          p_body: string
          p_event_id: string
          p_html: string
          p_lease_token: string
          p_occurred_at: string
          p_opt_action?: string
          p_recipient: string
          p_reply_ids: string[]
          p_rfc_message_id: string
          p_sender: string
          p_subject: string
        }
        Returns: {
          attachment_metadata: NonNullable<Json>
          body: string
          channel: string
          client_id: string | null
          conversation_id: string | null
          direction: string
          event_id: string | null
          html_body: string | null
          id: string
          message_id: string | null
          occurred_at: string
          provider: string
          received_at: string
          recipient: string
          reply_ids: string[]
          resource_id: string
          review_reason: string | null
          rfc_message_id: string | null
          sender: string
          subject: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "communication_inbound"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_payment_reconciliation: {
        Args: {
          p_attest: boolean
          p_case_id: string
          p_expected_case_hash: string
          p_reviewed_proof_hash: string
        }
        Returns: Json
      }
      configure_native_prescriber: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      configure_native_return_policy: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      configure_payment_provider: {
        Args: {
          p_account_id: string
          p_livemode: boolean
          p_return_origin: string
        }
        Returns: {
          account_id: string
          created_at: string
          livemode: boolean
          return_origin: string
          singleton: boolean
        }
        SetofOptions: {
          from: "*"
          to: "payment_provider_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_record_release: {
        Args: {
          p_attest_review: boolean
          p_channel: string
          p_client_id: string
          p_id: string
          p_pet_id: string
          p_recipient: string
          p_reviewed_hash: string
          p_reviewed_snapshot: Json
          p_selection: Json
        }
        Returns: {
          channel: string
          client_id: string
          created_at: string
          created_by: string
          id: string
          pet_id: string
          recipient: string
          request: NonNullable<Json>
          selection: NonNullable<Json>
          snapshot: NonNullable<Json>
          source_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "record_releases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_contact_intake_budget: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      contact_intake_receipt: {
        Args: { p_capability_hash: string; p_request_id: string }
        Returns: Json
      }
      contact_sms_consent_disclosure: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      conversation_attachment_storage_read: {
        Args: { p_path: string }
        Returns: boolean
      }
      conversation_attachment_storage_write: {
        Args: { p_path: string }
        Returns: boolean
      }
      conversation_email_capture_context: {
        Args: { p_actor_id: string; p_request_id: string }
        Returns: Json
      }
      conversation_email_delivery_context: {
        Args: { p_lease_token: string; p_outbox_id: string }
        Returns: Json
      }
      correct_lesion_observation: {
        Args: { p_id: string; p_observation_id: string; p_reason: string }
        Returns: {
          created_at: string
          created_by: string
          id: string
          observation_id: string
          reason: string
        }
        SetofOptions: {
          from: "*"
          to: "patient_lesion_corrections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      correct_patient_treatment: {
        Args: {
          p_id: string
          p_reason: string
          p_replacement_id: string
          p_treatment_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          id: string
          reason: string
          replacement_id: string | null
          treatment_id: string
        }
        SetofOptions: {
          from: "*"
          to: "patient_treatment_corrections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_billing_invoice: {
        Args: { p_client_id: string; p_id: string }
        Returns: {
          client_id: string
          created_at: string
          created_by: string
          currency: string
          id: string
          issued_at: string | null
          status: string
          total_cents: number | null
          version: number
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "billing_invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_inventory_product: {
        Args: {
          p_id: string
          p_kind: string
          p_manufacturer: string
          p_name: string
          p_unit: string
          p_unit_price_cents: number
        }
        Returns: {
          active: boolean
          created_at: string
          created_by: string
          id: string
          kind: string
          manufacturer: string
          name: string
          unit: string
          unit_price_cents: number
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "catalog_products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_native_refill: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      credit_billing_invoice: {
        Args: {
          p_amount_cents: number
          p_id: string
          p_invoice_id: string
          p_reason: string
        }
        Returns: {
          amount_cents: number
          created_at: string
          created_by: string
          id: string
          invoice_id: string
          reason: string
        }
        SetofOptions: {
          from: "*"
          to: "billing_credits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_sms_consent: { Args: { p_client_id: string }; Returns: Json }
      delete_conversation_cascade: {
        Args: { conv_id: string }
        Returns: undefined
      }
      dental_tooth_numbers: {
        Args: { p_dentition: string; p_species: string }
        Returns: string[]
      }
      dental_validate_data: {
        Args: {
          p_dentition: string
          p_notes: string
          p_species: string
          p_teeth: Json
          p_visit_at: string
        }
        Returns: undefined
      }
      disable_reminder_automation_policy: {
        Args: {
          p_expected_version: number
          p_id: string
          p_review_note: string
        }
        Returns: {
          approved_at: string
          approved_by: string
          channel: string
          enabled: boolean
          id: string
          message_template_id: string
          message_template_version: number
          review_note: string
          source_kind: string
          subject: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "reminder_automation_policies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      document_link_access_context: { Args: { p_id: string }; Returns: Json }
      document_link_capture_context: {
        Args: { p_actor_id: string; p_id: string }
        Returns: Json
      }
      document_link_current: { Args: { p_id: string }; Returns: Json }
      document_link_delivery_context: {
        Args: { p_lease_token: string; p_outbox_id: string }
        Returns: Json
      }
      document_link_source: {
        Args: { p_client_id: string; p_family: string; p_source_id: string }
        Returns: Json
      }
      enqueue_care_reminder: {
        Args: {
          p_expected_source_version: number
          p_expected_template_version: number
          p_id: string
          p_message_template_id: string
          p_source_id: string
          p_source_kind: string
        }
        Returns: {
          channel: string
          client_id: string
          created_at: string
          due_on: string
          id: string
          invalidated_at: string | null
          invalidation_reason: string | null
          message_template_id: string
          message_template_version: number
          pet_id: string
          rendered_body: string
          scheduled_on: string
          source_id: string
          source_kind: string
          source_snapshot: NonNullable<Json>
          source_version: number
          status: string
          template_snapshot: NonNullable<Json>
        }
        SetofOptions: {
          from: "*"
          to: "care_reminder_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_communication: {
        Args: {
          p_actor_id: string
          p_attachment_ids?: string[]
          p_body: string
          p_channel: string
          p_conversation_id: string
          p_recipient: string
          p_request_id: string
          p_subject: string
        }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_conversation_email: {
        Args: {
          p_attest: boolean
          p_request_id: string
          p_reviewed_payload_hash: string
        }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_document_link_sms: {
        Args: {
          p_attest: boolean
          p_request_id: string
          p_reviewed_artifact_hash: string
          p_reviewed_message_hash: string
        }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_due_appointment_reminders: {
        Args: { p_batch_size?: number; p_enqueued_at?: string }
        Returns: {
          action: string
          outbound_delivery_id: string
          reminder_id: string
          reminder_status: Database["public"]["Enums"]["reminder_status"]
          status_note: string
        }[]
      }
      enqueue_invoice_email: {
        Args: {
          p_attest: boolean
          p_request_id: string
          p_reviewed_payload_hash: string
        }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_payment_delivery: {
        Args: {
          p_attest: boolean
          p_request_id: string
          p_reviewed_message_hash: string
          p_reviewed_payload_hash: string
        }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_prepared_communication_internal: {
        Args: {
          p_actor_id: string
          p_attachment_ids?: string[]
          p_body: string
          p_channel: string
          p_conversation_id: string
          p_recipient: string
          p_request_id: string
          p_subject: string
        }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_release_email: {
        Args: {
          p_attest: boolean
          p_request_id: string
          p_reviewed_payload_hash: string
        }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_staff_outbound_message: {
        Args: {
          p_actor_id: string
          p_body?: string
          p_channel: Database["public"]["Enums"]["channel_type"]
          p_conversation_id: string
          p_idempotency_key?: string
          p_recipient: string
          p_requested_at?: string
          p_subject?: string
        }
        Returns: {
          enqueue_status: string
          message_id: string
          outbound_delivery_id: string
        }[]
      }
      ensure_active_conversation: {
        Args: { p_client_id: string }
        Returns: {
          archived_at: string | null
          assigned_to_id: string | null
          client_id: string
          created_at: string
          first_message_at: string | null
          first_response_at: string | null
          id: string
          is_read: boolean
          last_message_at: string
          priority: Database["public"]["Enums"]["conversation_priority"]
          revision: number
          status: Database["public"]["Enums"]["conversation_status"]
          tags: string[]
        }
        SetofOptions: {
          from: "*"
          to: "conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      execute_reminder_scheduler_run: {
        Args: { p_run_id: string }
        Returns: Json
      }
      external_record_capture_context: {
        Args: { p_actor_id: string; p_receipt_id: string }
        Returns: Json
      }
      ezyvet_approve_history_request: {
        Args: {
          p_confirmed: boolean
          p_expected_hash: string
          p_id: string
          p_kind: string
          p_pet_id: string
        }
        Returns: Json
      }
      ezyvet_attachment_capture_current: {
        Args: { p_id: string }
        Returns: boolean
      }
      ezyvet_attachment_capture_lock_source: {
        Args: { p_claim_slot?: boolean; p_id: string }
        Returns: undefined
      }
      ezyvet_attachment_capture_prepare_core: {
        Args: {
          p_abandon: boolean
          p_animal_link_id: string
          p_id: string
          p_observed_head_version: number
          p_ordinal: number
          p_page: number
          p_run_id: string
          p_snapshot_id: string
          p_stable_metadata_sha256: string
        }
        Returns: Json
      }
      ezyvet_attachment_capture_private: {
        Args: { p_id: string }
        Returns: Json
      }
      ezyvet_attachment_capture_projection: {
        Args: { p_id: string }
        Returns: Json
      }
      ezyvet_attachment_capture_require_lease: {
        Args: { p_actor: string; p_id: string; p_lease_id: string }
        Returns: {
          animal_link_id: string
          client_id: string
          created_at: string
          external_id: string
          file_id: string
          id: string
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          metadata: NonNullable<Json>
          observed_head_version: number
          ordinal: number
          page: number
          parent_context: NonNullable<Json>
          pet_id: string
          raw_record_sha256: string
          request_hash: string
          request_payload: NonNullable<Json>
          requested_by: string
          retry_after: string | null
          run_id: string
          snapshot_id: string
          stable_metadata_sha256: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_attachment_capture_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ezyvet_attachment_original_source_gate: {
        Args: { p_ignore_request?: string; p_origin: string; p_site: string }
        Returns: undefined
      }
      ezyvet_attachment_original_storage_insert: {
        Args: { p_path: string }
        Returns: boolean
      }
      ezyvet_attachment_parent_context: {
        Args: { p_animal_link_id: string; p_origin: string; p_site: string }
        Returns: Json
      }
      ezyvet_attachment_run_projection: {
        Args: { p_id: string }
        Returns: Json
      }
      ezyvet_attachment_validate_page: {
        Args: { p_page: Json; p_parent_id: string }
        Returns: undefined
      }
      ezyvet_clinical_run_projection: { Args: { p_id: string }; Returns: Json }
      ezyvet_discrepancy_projection: { Args: { p_id: string }; Returns: Json }
      ezyvet_extraction_projection: { Args: { p_id: string }; Returns: Json }
      ezyvet_history_compact: { Args: { p_id: string }; Returns: Json }
      ezyvet_history_current: { Args: { p_id: string }; Returns: Json }
      ezyvet_history_identity_valid: {
        Args: { p_id: string }
        Returns: boolean
      }
      ezyvet_history_request_projection: {
        Args: { p_id: string }
        Returns: Json
      }
      ezyvet_history_require_actor: {
        Args: { p_kind: string }
        Returns: string
      }
      ezyvet_history_review_context: {
        Args: { p_kind: string; p_payload: Json; p_pet_id: string }
        Returns: Json
      }
      ezyvet_history_source_context: {
        Args: { p_payload: Json; p_pet_id: string }
        Returns: Json
      }
      ezyvet_imported_history_projection: {
        Args: { p_id: string }
        Returns: Json
      }
      ezyvet_imported_prescription_projection: {
        Args: { p_id: string }
        Returns: Json
      }
      ezyvet_imported_vaccination_projection: {
        Args: { p_id: string }
        Returns: Json
      }
      ezyvet_is_active_admin: { Args: { p_actor: string }; Returns: boolean }
      ezyvet_migration_resolution_context: {
        Args: { p_scope_id: string; p_target: Json }
        Returns: Json
      }
      ezyvet_migration_resolution_receipt: {
        Args: {
          p_row: Database["public"]["Tables"]["ezyvet_migration_resolutions"]["Row"]
        }
        Returns: Json
      }
      ezyvet_migration_resolution_target: {
        Args: { p_target: Json }
        Returns: Json
      }
      ezyvet_prepare_history_request: {
        Args: {
          p_id: string
          p_kind: string
          p_payload: Json
          p_pet_id: string
        }
        Returns: Json
      }
      ezyvet_prescription_current: { Args: { p_id: string }; Returns: Json }
      ezyvet_prescription_interpretation_context: {
        Args: { p_review: Json; p_source: Json }
        Returns: Json
      }
      ezyvet_prescription_interpretation_hash: {
        Args: { p_context: Json }
        Returns: string
      }
      ezyvet_prescription_reference_id: {
        Args: { p_value: Json }
        Returns: string
      }
      ezyvet_prescription_require_dvm: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      ezyvet_prescription_review_date: {
        Args: { p_date: Json; p_status: Json }
        Returns: undefined
      }
      ezyvet_prescription_review_predecessor: {
        Args: { p_context: Json; p_review: Json }
        Returns: {
          animal_link_id: string
          approved_at: string
          approved_by: string
          client_id: string
          context: NonNullable<Json>
          expected_predecessor_hash: string | null
          id: string
          interpretation_hash: string
          pet_id: string
          prescription_external_id: string
          reason: string
          replaces_id: string | null
          source_origin: string
          source_site_uid: string
          version: number
          version_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_imported_prescriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ezyvet_prescription_review_projection: {
        Args: { p_id: string }
        Returns: Json
      }
      ezyvet_prescription_run_projection: {
        Args: { p_id: string }
        Returns: Json
      }
      ezyvet_prescription_source_context: {
        Args: { p_item_run_id: string; p_pet_id: string }
        Returns: Json
      }
      ezyvet_prescriptionitem_run_projection: {
        Args: { p_id: string }
        Returns: Json
      }
      ezyvet_problem_fields: {
        Args: { p: Database["public"]["Tables"]["patient_problems"]["Row"] }
        Returns: Json
      }
      ezyvet_reconcile_prescription_items: {
        Args: { p_observed: Json; p_scan_complete: boolean; p_source: Json }
        Returns: Json
      }
      ezyvet_release_attachment_current: {
        Args: { p_id: string }
        Returns: boolean
      }
      ezyvet_vaccination_current: { Args: { p_id: string }; Returns: Json }
      ezyvet_vaccination_require_dvm: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      ezyvet_vaccination_review_context: {
        Args: { p_payload: Json; p_pet_id: string }
        Returns: Json
      }
      ezyvet_vaccination_review_predecessor: {
        Args: { p_context: Json; p_payload: Json }
        Returns: {
          animal_external_id: string
          animal_link_id: string
          approved_at: string
          approved_by: string
          client_id: string
          consult: NonNullable<Json>
          expected_predecessor_hash: string | null
          id: string
          interpretation_hash: string
          observed_head_version: number
          original: NonNullable<Json>
          payload_hash: string
          pet_id: string
          product: Json | null
          reason: string
          replaces_id: string | null
          reviewed: NonNullable<Json>
          snapshot_id: string
          source_origin: string
          source_site_uid: string
          vaccination_external_id: string
          version: number
          version_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_imported_vaccinations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ezyvet_vaccination_review_projection: {
        Args: { p_id: string }
        Returns: Json
      }
      ezyvet_vaccination_run_projection: {
        Args: { p_id: string }
        Returns: Json
      }
      ezyvet_validate_history_sources: {
        Args: { p_pet_id: string; p_sources: Json }
        Returns: Json
      }
      ezyvet_validate_prescriptionitem_prescription: {
        Args: {
          p_animal_link_id: string
          p_prescription_observed_head_version: number
          p_prescription_payload_hash: string
          p_prescription_snapshot_id: string
          p_site_uid: string
          p_source_origin: string
        }
        Returns: {
          created_at: string
          external_id: string
          first_seen_by: string
          id: string
          payload: NonNullable<Json>
          payload_hash: string
          resource: string
          source_origin: string
          source_site_uid: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_snapshots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ezyvet_validate_release_attachments: {
        Args: { p_pet_id: string; p_sources: Json }
        Returns: Json
      }
      ezyvet_validate_reviewed_prescriptions: {
        Args: { p_pet_id: string; p_sources: Json }
        Returns: Json
      }
      ezyvet_validate_reviewed_vaccinations: {
        Args: { p_pet_id: string; p_sources: Json }
        Returns: Json
      }
      ezyvet_validate_vaccination_consult: {
        Args: {
          p_animal_link_id: string
          p_consult_observed_head_version: number
          p_consult_payload_hash: string
          p_consult_snapshot_id: string
          p_site_uid: string
          p_source_origin: string
        }
        Returns: {
          created_at: string
          external_id: string
          first_seen_by: string
          id: string
          payload: NonNullable<Json>
          payload_hash: string
          resource: string
          source_origin: string
          source_site_uid: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_snapshots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_ezyvet_attachment_capture: {
        Args: {
          p_actor: string
          p_code: string
          p_id: string
          p_lease_id: string
          p_retry_seconds: number
          p_terminal: boolean
        }
        Returns: Json
      }
      fail_ezyvet_import_page: {
        Args: {
          p_actor: string
          p_code: string
          p_id: string
          p_lease_id: string
          p_retry_seconds: number
        }
        Returns: undefined
      }
      finalize_abandoned_attachment_cleanup: {
        Args: { p_id: string; p_token: string }
        Returns: Json
      }
      finalize_inbound_attachment: {
        Args: {
          p_actor_id: string
          p_byte_length: number
          p_id: string
          p_mime_type: string
          p_sha256: string
          p_token: string
        }
        Returns: Json
      }
      finalize_patient_document: {
        Args: { p_id: string }
        Returns: {
          category: string
          created_at: string
          created_by: string
          document_date: string | null
          encounter_id: string | null
          file_name: string
          file_path: string
          file_size: number
          finalized_at: string | null
          id: string
          mime_type: string
          pet_id: string
          source: string
          status: string
          version: number
          visibility: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "patient_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finish_communication_attempt: {
        Args: {
          p_error_code: string
          p_id: string
          p_lease_token: string
          p_outcome: string
          p_provider_message_id: string
        }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finish_stripe_event: {
        Args: { p_evidence: Json; p_lease_token: string; p_receipt_id: string }
        Returns: string
      }
      get_consent_submission: {
        Args: { p_token: string }
        Returns: {
          access_token: string
          client_id: string
          conversation_id: string | null
          created_at: string
          expires_at: string
          form_data: NonNullable<Json>
          id: string
          ip_address: string | null
          pet_id: string | null
          signature_data: string | null
          signed_at: string | null
          status: string
          template_id: string
          ticket_id: string | null
          user_agent: string | null
        }
        SetofOptions: {
          from: "*"
          to: "consent_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_current_on_call: {
        Args: Record<PropertyKey, never>
        Returns: {
          dvm_id: string
          dvm_name: string
          phone_number: string
          schedule_id: string
        }[]
      }
      get_ezyvet_attachment_capture_context: {
        Args: { p_actor: string; p_id: string }
        Returns: Json
      }
      get_ezyvet_prescription_review_candidate: {
        Args: { p_item_run_id: string; p_pet_id: string }
        Returns: Json
      }
      get_last_messages: {
        Args: { conv_ids: string[] }
        Returns: {
          content: string
          conversation_id: string
          created_at: string
          type: Database["public"]["Enums"]["message_type"]
        }[]
      }
      get_reviewed_ezyvet_original_context: {
        Args: {
          p_actor: string
          p_capture_hash: string
          p_pet_id: string
          p_record_id: string
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["user_role"]
          _user_id: string
        }
        Returns: boolean
      }
      inbound_capture_receipt: {
        Args: {
          p_row: Database["public"]["Tables"]["inbound_attachment_captures"]["Row"]
        }
        Returns: Json
      }
      inbox_unread_totals: {
        Args: Record<PropertyKey, never>
        Returns: {
          unread_conversations: number
          unread_messages: number
        }[]
      }
      ingest_cloudtalk_event: {
        Args: {
          p_data: Json
          p_event_id: string
          p_event_type: string
          p_occurred_at: string
        }
        Returns: boolean
      }
      inspect_payment_collection: {
        Args: {
          p_collection_token_hash: string
          p_grant_id: string
          p_key_version: string
          p_origin: string
        }
        Returns: Json
      }
      inventory_lot_balances: {
        Args: { p_limit?: number; p_product_id?: string; p_search?: string }
        Returns: {
          active: boolean
          balance: number
          expires_on: string
          id: string
          kind: string
          location: string
          lot_number: string
          product_id: string
          product_name: string
          unit: string
        }[]
      }
      invoice_document_internal: {
        Args: { p_client_id: string; p_invoice_id: string }
        Returns: Json
      }
      invoice_email_capture_context: {
        Args: { p_actor_id: string; p_request_id: string }
        Returns: Json
      }
      invoice_email_context: { Args: { p_request_id: string }; Returns: Json }
      invoice_email_preview_internal: {
        Args: { p_client_id: string; p_invoice_id: string }
        Returns: Json
      }
      is_active_staff: { Args: { _user_id: string }; Returns: boolean }
      issue_billing_invoice: {
        Args: { p_expected_version: number; p_id: string }
        Returns: {
          client_id: string
          created_at: string
          created_by: string
          currency: string
          id: string
          issued_at: string | null
          status: string
          total_cents: number | null
          version: number
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "billing_invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      issue_vaccine_certificate: {
        Args: {
          p_attest_review: boolean
          p_details: Json
          p_id: string
          p_kind: string
          p_pet_id: string
          p_rabies_treatment_id: string
          p_reason?: string
          p_replaces_id?: string
          p_reviewed_snapshot: Json
          p_signature_name: string
        }
        Returns: {
          attestation: string
          id: string
          issued_at: string
          issued_by: string
          kind: string
          pet_id: string
          replaces_id: string | null
          request: NonNullable<Json>
          signature_name: string
          snapshot: NonNullable<Json>
        }
        SetofOptions: {
          from: "*"
          to: "vaccine_certificates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lab_report_capture_context: {
        Args: { p_actor_id: string; p_receipt_id: string }
        Returns: Json
      }
      link_lab_report_version: {
        Args: {
          p_attest: boolean
          p_expected_capture_hash: string
          p_expected_order_version: number
          p_expected_receipt_hash: string
          p_id: string
          p_kind: string
          p_order_id: string
          p_pet_id: string
          p_previous_report_id: string
          p_receipt_id: string
          p_review_reason: string
          p_source_review_id: string
        }
        Returns: {
          actor_id: string
          capture_hash: string
          created_at: string
          document_id: string
          document_version: number
          id: string
          kind: string
          order_id: string
          order_version: number
          pet_id: string
          previous_report_id: string | null
          receipt_hash: string
          receipt_id: string
          review_reason: string
          source_review_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "lab_report_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      list_abandoned_attachment_cleanup_candidates: {
        Args: { p_grace_hours: number; p_limit: number }
        Returns: Json
      }
      list_care_reminder_candidates: {
        Args: {
          p_after_id?: string
          p_after_kind?: string
          p_limit?: number
          p_through: string
        }
        Returns: {
          due_on: string
          pet_id: string
          source_id: string
          source_kind: string
          source_version: number
        }[]
      }
      list_communication_event_retries: {
        Args: { p_before_at?: string; p_before_id?: string; p_limit?: number }
        Returns: Json
      }
      list_communication_inbox: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_search?: string
        }
        Returns: {
          client_id: string
          client_name: string
          conversation_id: string
          latest_content: string
          latest_message_id: string
          latest_type: Database["public"]["Enums"]["message_type"]
          unread_count: number
          updated_at: string
        }[]
      }
      list_communication_processing_queue: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_state?: string
        }
        Returns: Json
      }
      list_conversation_message_attachments: {
        Args: { p_message_ids: string[] }
        Returns: {
          files: Json
          message_id: string
          payload_hash: string
          request_id: string
        }[]
      }
      list_external_record_receipts: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_ezyvet_attachment_capture_mappings: {
        Args: { p_before_at?: string; p_before_id?: string; p_limit?: number }
        Returns: Json
      }
      list_ezyvet_attachment_captures: {
        Args: {
          p_animal_link_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      list_ezyvet_attachment_observations: {
        Args: {
          p_after_ordinal?: number
          p_after_page?: number
          p_animal_link_id: string
          p_limit?: number
          p_run_id: string
        }
        Returns: Json
      }
      list_ezyvet_attachment_record_versions: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
          p_request_id: string
        }
        Returns: Json
      }
      list_ezyvet_attachment_runs: {
        Args: {
          p_animal_link_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      list_ezyvet_clinical_candidates: {
        Args: {
          p_animal_link_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_resource: string
        }
        Returns: Json
      }
      list_ezyvet_clinical_runs: {
        Args: {
          p_animal_link_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_resource: string
        }
        Returns: Json
      }
      list_ezyvet_history_requests: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_kind: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_ezyvet_migration_attempt_events: {
        Args: {
          p_before_sequence?: number
          p_binding_id: string
          p_limit?: number
        }
        Returns: Json
      }
      list_ezyvet_migration_bindings: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_scope_id: string
        }
        Returns: Json
      }
      list_ezyvet_migration_capture_evidence: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_binding_id: string
          p_evidence_hash: string
          p_limit?: number
          p_ordinal: number
          p_page: number
          p_snapshot_id: string
        }
        Returns: Json
      }
      list_ezyvet_migration_history_evidence: {
        Args: {
          p_before_version?: number
          p_binding_id: string
          p_evidence_hash: string
          p_limit?: number
          p_page: number
          p_snapshot_id: string
        }
        Returns: Json
      }
      list_ezyvet_migration_items: {
        Args: {
          p_after_ordinal?: number
          p_after_page?: number
          p_after_snapshot_id?: string
          p_binding_id: string
          p_limit?: number
        }
        Returns: Json
      }
      list_ezyvet_migration_prescription_evidence: {
        Args: {
          p_before_version?: number
          p_binding_id: string
          p_evidence_hash: string
          p_limit?: number
          p_page: number
          p_snapshot_id: string
        }
        Returns: Json
      }
      list_ezyvet_migration_prescription_item_evidence: {
        Args: {
          p_before_version?: number
          p_binding_id: string
          p_evidence_hash: string
          p_limit?: number
          p_page: number
          p_snapshot_id: string
        }
        Returns: Json
      }
      list_ezyvet_migration_resolutions: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_scope_id: string
          p_target?: Json
        }
        Returns: Json
      }
      list_ezyvet_migration_runs: {
        Args: { p_before_at?: string; p_before_id?: string; p_limit?: number }
        Returns: Json
      }
      list_ezyvet_migration_vaccination_evidence: {
        Args: {
          p_before_version?: number
          p_binding_id: string
          p_evidence_hash: string
          p_limit?: number
          p_page: number
          p_snapshot_id: string
        }
        Returns: Json
      }
      list_ezyvet_migration_weight_evidence: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_binding_id: string
          p_evidence_hash: string
          p_limit?: number
          p_page: number
          p_snapshot_id: string
        }
        Returns: Json
      }
      list_ezyvet_prescription_candidates: {
        Args: {
          p_animal_link_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_resource: string
        }
        Returns: Json
      }
      list_ezyvet_prescription_review_candidates: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_ezyvet_prescription_review_requests: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_ezyvet_prescription_runs: {
        Args: {
          p_animal_link_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_resource: string
        }
        Returns: Json
      }
      list_ezyvet_prescriptionitem_candidates: {
        Args: {
          p_animal_link_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      list_ezyvet_prescriptionitem_runs: {
        Args: {
          p_animal_link_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      list_ezyvet_vaccination_candidates: {
        Args: {
          p_animal_link_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      list_ezyvet_vaccination_review_candidates: {
        Args: {
          p_animal_link_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_ezyvet_vaccination_review_mappings: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      list_ezyvet_vaccination_review_requests: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_ezyvet_vaccination_runs: {
        Args: {
          p_animal_link_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      list_ezyvet_weight_candidates: {
        Args: {
          p_animal_link_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: Json[]
      }
      list_household_timeline: {
        Args: {
          p_before_at?: string
          p_before_key?: string
          p_client_id: string
          p_kinds?: string[]
          p_limit?: number
        }
        Returns: Json
      }
      list_inbound_message_attachments: {
        Args: { p_message_ids: string[] }
        Returns: Json
      }
      list_inbox_workspace: {
        Args: {
          p_assigned_to_id?: string
          p_assignment?: string
          p_before_at?: string
          p_before_id?: string
          p_channel?: Database["public"]["Enums"]["message_type"]
          p_limit?: number
          p_priority?: Database["public"]["Enums"]["conversation_priority"]
          p_read?: string
          p_search?: string
          p_status?: Database["public"]["Enums"]["conversation_status"]
          p_tags?: string[]
        }
        Returns: {
          assigned_to_id: string | null
          client_id: string | null
          client_name: string | null
          conversation_id: string | null
          is_unread: boolean | null
          latest_content: string | null
          latest_message_id: string | null
          latest_type: Database["public"]["Enums"]["message_type"] | null
          primary_email: string | null
          primary_phone: string | null
          priority: Database["public"]["Enums"]["conversation_priority"] | null
          revision: number | null
          status: Database["public"]["Enums"]["conversation_status"] | null
          tags: string[] | null
          unread_count: number | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "inbox_workspace_rows"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_legacy_refills: {
        Args: { p_before_at?: string; p_before_id?: string; p_limit?: number }
        Returns: Json
      }
      list_native_dispense_corrections: {
        Args: {
          p_authorization_id: string
          p_before_version?: number
          p_dispense_id: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_native_dispense_returns: {
        Args: {
          p_authorization_id: string
          p_before_version?: number
          p_dispense_id: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_native_dispense_returns_v2: {
        Args: {
          p_authorization_id: string
          p_before_version?: number
          p_dispense_id: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_native_dispenses: {
        Args: {
          p_authorization_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_native_estimate_drafts: {
        Args: {
          p_before_at: string
          p_before_id: string
          p_client_id: string
          p_limit: number
        }
        Returns: Json
      }
      list_native_fill_slots: {
        Args: {
          p_after_index?: number
          p_authorization_id: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_native_pickups: {
        Args: {
          p_authorization_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_native_prescribers: {
        Args: { p_after_id?: string; p_limit?: number }
        Returns: Json
      }
      list_native_prescription_drafts: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_native_prescription_events: {
        Args: {
          p_authorization_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_native_refill_events: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
          p_refill_id: string
        }
        Returns: Json
      }
      list_native_refills: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id?: string
        }
        Returns: Json
      }
      list_native_slot_closures: {
        Args: {
          p_authorization_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_outbox_retry_actions: {
        Args: { p_before_at?: string; p_before_id?: string; p_limit?: number }
        Returns: Json
      }
      list_patient_imported_histories: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_patient_imported_prescriptions: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_patient_imported_vaccinations: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      list_patient_timeline: {
        Args: {
          p_before_at?: string
          p_before_key?: string
          p_kinds?: string[]
          p_limit?: number
          p_patient_id: string
        }
        Returns: Json
      }
      list_payment_collections: {
        Args: { p_client_id: string; p_invoice_id: string }
        Returns: Json
      }
      list_payment_deliveries: {
        Args: { p_grant_id?: string; p_invoice_id: string }
        Returns: Json
      }
      list_payment_reconciliation_workspace: {
        Args: { p_invoice_id: string }
        Returns: Json
      }
      list_record_release_sources: {
        Args: { p_offset?: number; p_pet_id: string }
        Returns: Json
      }
      list_record_release_sources_v10: {
        Args: { p_offset?: number; p_pet_id: string }
        Returns: Json
      }
      list_record_release_sources_v11: {
        Args: { p_offset?: number; p_pet_id: string }
        Returns: Json
      }
      list_record_release_sources_v12: {
        Args: { p_offset?: number; p_pet_id: string }
        Returns: Json
      }
      list_record_release_sources_v13: {
        Args: { p_offset?: number; p_pet_id: string }
        Returns: Json
      }
      list_record_release_sources_v5: {
        Args: { p_offset?: number; p_pet_id: string }
        Returns: Json
      }
      list_record_release_sources_v6: {
        Args: { p_offset?: number; p_pet_id: string }
        Returns: Json
      }
      list_record_release_sources_v7: {
        Args: { p_offset?: number; p_pet_id: string }
        Returns: Json
      }
      list_record_release_sources_v8: {
        Args: { p_offset?: number; p_pet_id: string }
        Returns: Json
      }
      list_record_release_sources_v9: {
        Args: { p_offset?: number; p_pet_id: string }
        Returns: Json
      }
      list_website_inquiries: {
        Args: {
          p_assigned_to_id?: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_search?: string
          p_status?: string
        }
        Returns: {
          assigned_to_id: string
          claimed_name: string
          client_id: string
          inquiry_id: string
          status: string
          subject: string
          submitted_at: string
          version: number
        }[]
      }
      mark_conversation_read: {
        Args: {
          p_actor_id: string
          p_conversation_id: string
          p_message_id: string
        }
        Returns: undefined
      }
      mark_conversation_unread: {
        Args: { p_actor_id: string; p_conversation_id: string }
        Returns: undefined
      }
      native_correction_actor: { Args: { p_kind: string }; Returns: Json }
      native_correction_disclosure: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      native_correction_instant: { Args: { v: Json }; Returns: string }
      native_correction_pickup: {
        Args: { p_dispense_id: string }
        Returns: Json
      }
      native_correction_print_legacy: {
        Args: { p_authorization_id: string; p_dispense_id?: string }
        Returns: Json
      }
      native_correction_receipt: {
        Args: {
          o: Database["public"]["Tables"]["native_dispense_correction_operations"]["Row"]
        }
        Returns: Json
      }
      native_correction_release_base: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      native_correction_summary: {
        Args: { p_authorization_id: string }
        Returns: Json
      }
      native_correction_uuid: {
        Args: { nullable?: boolean; v: Json }
        Returns: string
      }
      native_correction_verified: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      native_estdec_access: {
        Args: {
          p_current: boolean
          p_grant_id: string
          p_key_version: string
          p_origin: string
          p_token_hash: string
        }
        Returns: Json
      }
      native_estdec_authorize: {
        Args: { p_current?: boolean; p_principal: Json; p_proof: Json }
        Returns: undefined
      }
      native_estdec_binding: { Args: { v: Json }; Returns: undefined }
      native_estdec_budget: { Args: { p_grant_id: string }; Returns: undefined }
      native_estdec_closure_document: {
        Args: {
          c: Database["public"]["Tables"]["native_estimate_decision_closures"]["Row"]
        }
        Returns: Json
      }
      native_estdec_context: {
        Args: { p_grant: Json; p_key_version: string; p_origin: string }
        Returns: string
      }
      native_estdec_current: {
        Args: { p_binding: Json; p_head: Json }
        Returns: Json
      }
      native_estdec_eligibility: { Args: { g: Json }; Returns: string }
      native_estdec_existing: {
        Args: {
          p_family: string
          p_id: string
          p_mutation: Json
          p_principal: Json
        }
        Returns: Json
      }
      native_estdec_grant_fold: { Args: { p_id: string }; Returns: Json }
      native_estdec_grant_view: { Args: { p_grant: Json }; Returns: Json }
      native_estdec_instant: { Args: { v: Json }; Returns: string }
      native_estdec_lock: {
        Args: { p_family: string; p_id: string; p_mutation: Json }
        Returns: Json
      }
      native_estdec_mutation: {
        Args: { p_family: string; v: Json }
        Returns: undefined
      }
      native_estdec_page: {
        Args: { p_before: number; p_limit: number }
        Returns: undefined
      }
      native_estdec_prefix: {
        Args: { p_at: string; p_binding: Json; p_head: Json; p_lifecycle: Json }
        Returns: undefined
      }
      native_estdec_principal: { Args: { v: Json }; Returns: undefined }
      native_estdec_public_decision: { Args: { d: Json }; Returns: Json }
      native_estdec_public_receipt: { Args: { r: Json }; Returns: Json }
      native_estdec_public_resolution: { Args: { r: Json }; Returns: Json }
      native_estdec_publication: {
        Args: { p_binding: Json; p_lifecycle: Json }
        Returns: Json
      }
      native_estdec_record: {
        Args: {
          p_id: string
          p_mutation: Json
          p_principal: Json
          p_proof: Json
        }
        Returns: Json
      }
      native_estdec_request: {
        Args: { p_grant: boolean; v: Json }
        Returns: undefined
      }
      native_estdec_request_hash: {
        Args: { p_family: string; p_mutation: Json; p_principal: Json }
        Returns: string
      }
      native_estdec_resolve: {
        Args: {
          p_close: boolean
          p_closed_by: Json
          p_family: string
          p_id: string
          p_mutation: Json
          p_principal: Json
          p_proof: Json
          p_reason: string
        }
        Returns: Json
      }
      native_estdec_scope: {
        Args: { p_family: string; p_mutation: Json }
        Returns: Json
      }
      native_estdec_staff_recovery: {
        Args: { p_family: string; p_id: string }
        Returns: Json
      }
      native_estdec_time: { Args: { p_time: string }; Returns: string }
      native_estdec_verified_closure: { Args: { p_id: string }; Returns: Json }
      native_estdec_verified_grant: { Args: { p_id: string }; Returns: Json }
      native_estdec_verified_operation: {
        Args: { p_id: string }
        Returns: Json
      }
      native_estdec_verified_state: {
        Args: { p_estimate_id: string }
        Returns: Json
      }
      native_estimate_capture_context: {
        Args: { p_actor_id: string; p_id: string }
        Returns: Json
      }
      native_estimate_decision_access_context: {
        Args: { p_grant_id: string }
        Returns: Json
      }
      native_estimate_decision_grant_capture_context: {
        Args: {
          p_actor_id: string
          p_grant_id: string
          p_key_version: string
          p_origin: string
        }
        Returns: Json
      }
      native_estimate_fields_total: {
        Args: { p_catalog?: Json; p_fields: Json }
        Returns: string
      }
      native_estimate_positive_int: { Args: { v: Json }; Returns: number }
      native_estimate_validate_request: {
        Args: { p_request: Json }
        Returns: undefined
      }
      native_estimate_verified_closure: {
        Args: { p_id: string }
        Returns: Json
      }
      native_estimate_verified_operation: {
        Args: { p_id: string }
        Returns: Json
      }
      native_estimate_verified_revision: {
        Args: { p_id: string; p_version: number }
        Returns: Json
      }
      native_estpub_artifact: {
        Args: { p_bytes: string; p_id: string; p_snapshot: Json }
        Returns: Json
      }
      native_estpub_closure: { Args: { p_id: string }; Returns: Json }
      native_estpub_context: {
        Args: {
          p_client_id: string
          p_draft_version: number
          p_estimate_id: string
        }
        Returns: Json
      }
      native_estpub_empty_head: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      native_estpub_hash: { Args: { v: Json }; Returns: undefined }
      native_estpub_head: { Args: { v: Json }; Returns: undefined }
      native_estpub_lifecycle: {
        Args: { p_estimate_id: string }
        Returns: Json
      }
      native_estpub_mutation: { Args: { v: Json }; Returns: undefined }
      native_estpub_practice: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      native_estpub_preparation: { Args: { p_id: string }; Returns: Json }
      native_estpub_prepare_request: { Args: { v: Json }; Returns: undefined }
      native_estpub_receipt: { Args: { p_id: string }; Returns: Json }
      native_estpub_record: {
        Args: { p_id: string; p_mutation: Json }
        Returns: Json
      }
      native_estpub_snapshot: {
        Args: { p_context: Json; p_id: string; p_stamp: string }
        Returns: Json
      }
      native_estpub_target: { Args: { v: Json }; Returns: undefined }
      native_finance_cents: { Args: { p_value: number }; Returns: string }
      native_finance_money: {
        Args: { p_positive?: boolean; p_value: Json }
        Returns: number
      }
      native_finance_review: { Args: { p_intent: Json }; Returns: Json }
      native_finance_snapshot: { Args: { p_target: Json }; Returns: Json }
      native_finance_validate_intent: {
        Args: { p_intent: Json }
        Returns: undefined
      }
      native_finance_validate_snapshot: {
        Args: { p_snapshot: Json }
        Returns: undefined
      }
      native_finance_verified_closure: { Args: { p_id: string }; Returns: Json }
      native_finance_verified_operation: {
        Args: { p_id: string }
        Returns: Json
      }
      native_fulfillment_begin: {
        Args: { p_id: string; p_kind: string; p_request: Json }
        Returns: Json
      }
      native_fulfillment_decimal: { Args: { n: number }; Returns: string }
      native_fulfillment_finish: {
        Args: { p_id: string; p_kind: string; p_request: Json; p_result: Json }
        Returns: Json
      }
      native_fulfillment_hash: { Args: { v: Json }; Returns: string }
      native_fulfillment_head: { Args: { p_id: string }; Returns: Json }
      native_fulfillment_history: {
        Args: {
          p_authorization_id: string
          p_before_at: string
          p_before_id: string
          p_kind: string
          p_limit: number
          p_pet_id: string
        }
        Returns: Json
      }
      native_fulfillment_index: { Args: { v: Json }; Returns: number }
      native_fulfillment_quantity: { Args: { v: Json }; Returns: number }
      native_fulfillment_receipt: {
        Args: {
          r: Database["public"]["Tables"]["native_fulfillment_operations"]["Row"]
        }
        Returns: Json
      }
      native_fulfillment_refill: {
        Args: { p_document: Json; p_target: Json }
        Returns: Json
      }
      native_fulfillment_refill_event: {
        Args: {
          p_context: Json
          p_dispense_id: string
          p_kind: string
          p_operation_id: string
          p_reason: string
        }
        Returns: Json
      }
      native_fulfillment_review_hash: {
        Args: { p_actual: string; p_expected: Json }
        Returns: undefined
      }
      native_fulfillment_slot: {
        Args: { s: Database["public"]["Tables"]["native_fill_slots"]["Row"] }
        Returns: Json
      }
      native_fulfillment_verified_dispense: {
        Args: { p_id: string }
        Returns: Json
      }
      native_reconciliation_affected: {
        Args: { p_dispense_id: string }
        Returns: boolean
      }
      native_reconciliation_attestations: {
        Args: { p_action: string }
        Returns: Json
      }
      native_reconciliation_authorization_affected: {
        Args: { a: string }
        Returns: boolean
      }
      native_reconciliation_balances: {
        Args: { p_replay: Json }
        Returns: Json
      }
      native_reconciliation_disclosure: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      native_reconciliation_discrepancies: {
        Args: { p_dispense_id: string; p_through?: number }
        Returns: Json
      }
      native_reconciliation_event_verified: {
        Args: {
          e: Database["public"]["Tables"]["native_return_events"]["Row"]
          p_corrections: Json
          p_dispense: Json
          p_head: Json
          p_prior: Json
        }
        Returns: undefined
      }
      native_reconciliation_intake: {
        Args: { p_intake_id: string; p_replay: Json }
        Returns: Json
      }
      native_reconciliation_lot_held: {
        Args: { p_lot_id: string }
        Returns: boolean
      }
      native_reconciliation_quantity_output: {
        Args: {
          histories: Json
          intake_order: string[]
          intakes: Json
          ordinary: Json
          ordinary_order: string[]
          p_originals: Json
          sources: Json
          totals: Json
        }
        Returns: Json
      }
      native_reconciliation_quantity_prefixes: {
        Args: { p_events: Json; p_originals: Json }
        Returns: Json
      }
      native_reconciliation_release_affected: {
        Args: { s: Json }
        Returns: boolean
      }
      native_reconciliation_summary: {
        Args: { p_authorization_id: string }
        Returns: Json
      }
      native_reconciliation_v1_verified: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      native_reconciliation_validate_intent: {
        Args: { v: Json }
        Returns: undefined
      }
      native_reconciliation_verified: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      native_refill_authorization_observation: {
        Args: { p_hash: string; p_id: string; p_pet_id: string }
        Returns: Json
      }
      native_refill_begin: {
        Args: { p_id: string; p_operation: string; p_request: Json }
        Returns: Json
      }
      native_refill_cursor: {
        Args: { p_before_at: string; p_before_id: string; p_limit: number }
        Returns: undefined
      }
      native_refill_event: {
        Args: { e: Database["public"]["Tables"]["native_refill_events"]["Row"] }
        Returns: Json
      }
      native_refill_finish: {
        Args: {
          p_action: string
          p_after: Database["public"]["Tables"]["native_refills"]["Row"]
          p_before: Json
          p_id: string
          p_link: Json
          p_operation: string
          p_request: Json
        }
        Returns: Json
      }
      native_refill_read_projection: {
        Args: { f: Database["public"]["Tables"]["native_refills"]["Row"] }
        Returns: Json
      }
      native_refill_receipt: {
        Args: {
          r: Database["public"]["Tables"]["native_refill_operations"]["Row"]
        }
        Returns: Json
      }
      native_return_balances: {
        Args: { p_before?: number; p_dispense_id: string }
        Returns: Json
      }
      native_return_disclosure: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      native_return_intake_balance: {
        Args: { p_before?: number; p_intake_id: string }
        Returns: Json
      }
      native_return_policy_receipt: {
        Args: {
          d: Database["public"]["Tables"]["native_return_policy_decisions"]["Row"]
        }
        Returns: Json
      }
      native_return_policy_verified: {
        Args: { p_version?: number }
        Returns: Json
      }
      native_return_print_base: {
        Args: { p_authorization_id: string; p_dispense_id?: string }
        Returns: Json
      }
      native_return_quantity_allocations: {
        Args: { p_allocations: Json }
        Returns: undefined
      }
      native_return_quantity_replay: {
        Args: { p_events: Json; p_originals: Json }
        Returns: Json
      }
      native_return_receipt: {
        Args: {
          o: Database["public"]["Tables"]["native_return_operations"]["Row"]
        }
        Returns: Json
      }
      native_return_release_affected: { Args: { s: Json }; Returns: boolean }
      native_return_release_base: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      native_return_summary: {
        Args: { p_authorization_id: string }
        Returns: Json
      }
      native_return_validate_intent: { Args: { v: Json }; Returns: undefined }
      native_return_verified: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      native_rx_append_event: {
        Args: {
          p_id: string
          p_preview: Json
          p_replacement_id?: string
          p_request: Json
        }
        Returns: Json
      }
      native_rx_begin: {
        Args: { p_id: string; p_operation: string; p_request: Json }
        Returns: Json
      }
      native_rx_change_context: {
        Args: { p_authorization_id: string; p_pet_id: string }
        Returns: Json
      }
      native_rx_check_change_context: {
        Args: { p_preview: Json; p_replace: boolean; p_request: Json }
        Returns: undefined
      }
      native_rx_check_change_request: {
        Args: { p_replace: boolean; p_request: Json }
        Returns: undefined
      }
      native_rx_day: { Args: { v: Json }; Returns: string }
      native_rx_event_projection: {
        Args: {
          e: Database["public"]["Tables"]["native_prescription_authorization_events"]["Row"]
        }
        Returns: Json
      }
      native_rx_finish: {
        Args: {
          p_id: string
          p_operation: string
          p_pet_id: string
          p_request: Json
          p_result: Json
        }
        Returns: Json
      }
      native_rx_keys: { Args: { keys: string[]; v: Json }; Returns: undefined }
      native_rx_materialize_authorization: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      native_rx_receipt: {
        Args: {
          r: Database["public"]["Tables"]["native_prescription_operations"]["Row"]
        }
        Returns: Json
      }
      native_rx_require_admin: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      native_rx_require_dvm: { Args: Record<PropertyKey, never>; Returns: Json }
      native_rx_revision: { Args: { v: Json }; Returns: number }
      native_rx_text: { Args: { max_length: number; v: Json }; Returns: string }
      native_rx_usage_context: {
        Args: { p_authorization_id: string }
        Returns: Json
      }
      native_rx_uuid: { Args: { nullable?: boolean; v: Json }; Returns: string }
      native_rx_valid_text: {
        Args: { max_length: number; v: Json }
        Returns: boolean
      }
      native_rx_validate_fields: {
        Args: { f: Json; p_client: string; p_pet: string }
        Returns: Json
      }
      native_rx_verified_authorization: {
        Args: { p_id: string }
        Returns: Json
      }
      normalize_sms_phone: { Args: { p_value: string }; Returns: string }
      operations_candidate_projection_internal: {
        Args: Record<PropertyKey, never>
        Returns: {
          channel: string
          cursor_key: string
          eligible_at: string
          job_id: string
          job_kind: string
          pet_id: string
          policy_id: string
          source_id: string
          source_kind: string
          source_version: number
          template_id: string
          template_version: number
        }[]
      }
      operations_outbox: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_filter?: string
          p_limit?: number
        }
        Returns: Json
      }
      operations_overview: { Args: Record<PropertyKey, never>; Returns: Json }
      operations_reminder_blocks: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_before_kind?: string
          p_limit?: number
        }
        Returns: Json
      }
      operations_reminder_candidates: {
        Args: { p_after_key?: string; p_limit?: number }
        Returns: Json
      }
      operations_require_admin: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      operations_scheduler_jobs: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      operations_scheduler_runs: {
        Args: { p_before_at?: string; p_before_id?: string; p_limit?: number }
        Returns: Json
      }
      outbound_delivery_sms_permitted: {
        Args: { p_delivery_id: string; p_lease_owner: string }
        Returns: boolean
      }
      outbox_retry_preview_internal: {
        Args: { p_outbox_id: string }
        Returns: Json
      }
      outbox_retry_source_internal: {
        Args: { p_outbox_id: string }
        Returns: Json
      }
      patient_360_estimate_status_internal: {
        Args: { p_estimate_id: string }
        Returns: Json
      }
      patient_360_header_internal: {
        Args: { p_client_id: string }
        Returns: Json
      }
      patient_360_signals_internal: {
        Args: { p_client_id: string; p_pet_id: string }
        Returns: Json
      }
      patient_360_timeline_internal: {
        Args: {
          p_before_at: string
          p_before_key: string
          p_client_id: string
          p_kinds: string[]
          p_limit: number
          p_pet_id: string
        }
        Returns: Json
      }
      patient_document_storage_read: {
        Args: { p_path: string }
        Returns: boolean
      }
      patient_document_storage_write: {
        Args: { p_path: string }
        Returns: boolean
      }
      patient_vaccine_status_summary: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      payment_balance_internal: {
        Args: { p_invoice_id: string }
        Returns: Json
      }
      payment_blocker_is_open: {
        Args: { p_id: string; p_kind: string }
        Returns: boolean
      }
      payment_collection_access_context: {
        Args: { p_grant_id: string }
        Returns: Json
      }
      payment_collection_capture_context: {
        Args: {
          p_actor_id: string
          p_key_version: string
          p_origin: string
          p_request_id: string
        }
        Returns: Json
      }
      payment_collection_read_internal: {
        Args: { p_id: string }
        Returns: Json
      }
      payment_collection_state_internal: {
        Args: { p_id: string }
        Returns: string
      }
      payment_collection_status_internal: {
        Args: { p_grant_id: string }
        Returns: Json
      }
      payment_delivery_capture_context: {
        Args: { p_actor_id: string; p_request_id: string }
        Returns: Json
      }
      payment_delivery_context: {
        Args: { p_lease_token: string; p_outbox_id: string }
        Returns: Json
      }
      payment_delivery_current: { Args: { p_id: string }; Returns: Json }
      payment_invoice_has_observations: {
        Args: { p_invoice_id: string }
        Returns: boolean
      }
      payment_reconciliation_hash_internal: {
        Args: { p_invoice_id: string }
        Returns: string
      }
      payment_reconciliation_target_internal: {
        Args: {
          p_family: string
          p_invoice_id: string
          p_object_id: string
          p_request_id: string
        }
        Returns: Json
      }
      payment_require_admin: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      payment_source_hash_internal: {
        Args: { p_client_id: string; p_invoice_id: string }
        Returns: string
      }
      prepare_conversation_attachment: {
        Args: {
          p_byte_length: number
          p_conversation_id: string
          p_file_name: string
          p_id: string
          p_mime_type: string
        }
        Returns: {
          actor_id: string
          byte_length: number
          conversation_id: string
          created_at: string
          file_name: string
          id: string
          mime_type: string
          sha256: string | null
          status: string
          storage_path: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "conversation_attachment_uploads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      prepare_conversation_email: {
        Args: {
          p_attachment_ids: string[]
          p_body: string
          p_conversation_id: string
          p_recipient: string
          p_request_id: string
          p_scope: string
          p_subject: string
        }
        Returns: Json
      }
      prepare_document_link: {
        Args: {
          p_client_id: string
          p_conversation_id: string
          p_expires_at: string
          p_family: string
          p_key_version: string
          p_message_template: string
          p_origin: string
          p_recipient: string
          p_request_id: string
          p_source_hash: string
          p_source_id: string
        }
        Returns: Json
      }
      prepare_ezyvet_attachment_capture: {
        Args: {
          p_animal_link_id: string
          p_id: string
          p_observed_head_version: number
          p_ordinal: number
          p_page: number
          p_run_id: string
          p_snapshot_id: string
          p_stable_metadata_sha256: string
        }
        Returns: Json
      }
      prepare_ezyvet_history_approval: {
        Args: { p_id: string; p_payload: Json; p_pet_id: string }
        Returns: Json
      }
      prepare_ezyvet_history_discrepancy: {
        Args: { p_id: string; p_payload: Json; p_pet_id: string }
        Returns: Json
      }
      prepare_ezyvet_migration_run: {
        Args: {
          p_id: string
          p_scopes: Json
          p_source_origin: string
          p_source_site_uid: string
        }
        Returns: Json
      }
      prepare_ezyvet_prescription_review: {
        Args: { p_id: string; p_payload: Json; p_pet_id: string }
        Returns: Json
      }
      prepare_ezyvet_problem_extraction: {
        Args: { p_id: string; p_payload: Json; p_pet_id: string }
        Returns: Json
      }
      prepare_ezyvet_vaccination_review: {
        Args: { p_id: string; p_payload: Json; p_pet_id: string }
        Returns: Json
      }
      prepare_ezyvet_weight_request: {
        Args: { p_payload: Json; p_request_id: string; p_snapshot_id: string }
        Returns: {
          actor_id: string
          created_at: string
          payload: Json | null
          request_id: string
          snapshot_id: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_weight_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      prepare_invoice_checkout: {
        Args: {
          p_account_id: string
          p_amount_cents: number
          p_cancel_url: string
          p_client_id: string
          p_invoice_id: string
          p_livemode: boolean
          p_request_id: string
          p_source_hash: string
          p_success_url: string
        }
        Returns: {
          account_id: string
          actor_id: string
          amount_cents: number
          cancel_url: string
          client_id: string
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          invoice_id: string
          livemode: boolean
          retry_before: string
          return_context_version: number
          return_key_version: string | null
          return_origin: string | null
          return_scope_id: string | null
          session_expires_at: string
          source_hash: string
          success_url: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_checkout_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      prepare_invoice_email: {
        Args: {
          p_body: string
          p_client_id: string
          p_conversation_id: string
          p_invoice_hash: string
          p_invoice_id: string
          p_recipient: string
          p_request_id: string
          p_subject: string
        }
        Returns: Json
      }
      prepare_invoice_refund: {
        Args: {
          p_amount_cents: number
          p_invoice_id: string
          p_payment_id: string
          p_reason: string
          p_request_id: string
        }
        Returns: {
          actor_id: string
          amount_cents: number
          created_at: string
          id: string
          idempotency_key: string
          invoice_id: string
          payment_id: string
          reason: string
          retry_before: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_refund_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      prepare_message_request: {
        Args: {
          p_actor_id: string
          p_attachment_ids?: string[]
          p_body: string
          p_channel: string
          p_conversation_id: string
          p_recipient: string
          p_request_id: string
          p_scope: string
          p_subject: string
        }
        Returns: Json
      }
      prepare_native_estimate_publication: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      prepare_patient_document: {
        Args: {
          p_category: string
          p_document_date: string
          p_encounter_id: string
          p_file_name: string
          p_file_size: number
          p_id: string
          p_mime_type: string
          p_pet_id: string
          p_source: string
          p_visibility: string
        }
        Returns: {
          category: string
          created_at: string
          created_by: string
          document_date: string | null
          encounter_id: string | null
          file_name: string
          file_path: string
          file_size: number
          finalized_at: string | null
          id: string
          mime_type: string
          pet_id: string
          source: string
          status: string
          version: number
          visibility: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "patient_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      prepare_payment_collection: {
        Args: {
          p_amount_cents: number
          p_client_id: string
          p_expires_at: string
          p_invoice_id: string
          p_request_id: string
          p_source_hash: string
        }
        Returns: Json
      }
      prepare_payment_delivery: {
        Args: {
          p_body_template: string
          p_channel: string
          p_conversation_id: string
          p_grant_id: string
          p_invoice_email_request_id?: string
          p_invoice_payload_hash?: string
          p_recipient: string
          p_request_id: string
          p_subject: string
        }
        Returns: Json
      }
      prepare_payment_reconciliation: {
        Args: {
          p_blocker_refs: Json
          p_case_id: string
          p_expected_case_hash: string
          p_family: string
          p_invoice_id: string
          p_provider_object_id: string
          p_request_id: string
        }
        Returns: Json
      }
      prepare_release_email: {
        Args: {
          p_body: string
          p_conversation_id: string
          p_release_hash: string
          p_release_id: string
          p_request_id: string
          p_subject: string
        }
        Returns: Json
      }
      preview_communication_event_retry: {
        Args: { p_event_id: string }
        Returns: Json
      }
      preview_document_link: {
        Args: { p_client_id: string; p_family: string; p_source_id: string }
        Returns: Json
      }
      preview_native_dispense: { Args: { p_target: Json }; Returns: Json }
      preview_native_dispense_correction: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      preview_native_dispense_finance: {
        Args: { p_intent: Json }
        Returns: Json
      }
      preview_native_dispense_return: {
        Args: { p_intent: Json }
        Returns: Json
      }
      preview_native_dispense_return_v2: {
        Args: { p_intent: Json }
        Returns: Json
      }
      preview_native_estimate_decision_grant: {
        Args: { p_client_id: string; p_publication_id: string }
        Returns: Json
      }
      preview_native_estimate_publication: {
        Args: {
          p_client_id: string
          p_draft_version: number
          p_estimate_id: string
        }
        Returns: Json
      }
      preview_native_pickup: {
        Args: { p_dispense_id: string; p_pet_id: string; p_refill_close?: Json }
        Returns: Json
      }
      preview_native_prescription_cancel: {
        Args: { p_authorization_id: string; p_pet_id: string }
        Returns: Json
      }
      preview_native_prescription_replacement: {
        Args: {
          p_authorization_id: string
          p_draft_id: string
          p_expected_version: number
          p_pet_id: string
        }
        Returns: Json
      }
      preview_native_prescription_sign: {
        Args: { p_draft_id: string; p_expected_version: number }
        Returns: Json
      }
      preview_native_refill_link: {
        Args: {
          p_authorization_id: string
          p_pet_id: string
          p_refill_id: string
        }
        Returns: Json
      }
      preview_native_return_discrepancy: {
        Args: { p_intent: Json }
        Returns: Json
      }
      preview_native_slot_close: {
        Args: {
          p_authorization_id: string
          p_pet_id: string
          p_slot_index: number
        }
        Returns: Json
      }
      preview_outbox_retry: { Args: { p_outbox_id: string }; Returns: Json }
      preview_payment_reconciliation: {
        Args: {
          p_family: string
          p_invoice_id: string
          p_provider_object_id: string
          p_request_id: string
        }
        Returns: Json
      }
      preview_record_release: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      preview_record_release_v1: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      preview_record_release_v10: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      preview_record_release_v11: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      preview_record_release_v12: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      preview_record_release_v13: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      preview_record_release_v2: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      preview_record_release_v4: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      preview_record_release_v5: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      preview_record_release_v6: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      preview_record_release_v7: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      preview_record_release_v8: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      preview_record_release_v9: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      preview_stripe_event_retry: {
        Args: { p_receipt_id: string }
        Returns: Json
      }
      preview_vaccine_certificate: {
        Args: {
          p_details: Json
          p_kind: string
          p_pet_id: string
          p_rabies_treatment_id: string
        }
        Returns: Json
      }
      preview_vaccine_certificate_v1_internal: {
        Args: {
          p_details: Json
          p_kind: string
          p_pet_id: string
          p_rabies_treatment_id: string
        }
        Returns: Json
      }
      preview_vaccine_certificate_v2_internal: {
        Args: {
          p_details: Json
          p_kind: string
          p_pet_id: string
          p_rabies_treatment_id: string
        }
        Returns: Json
      }
      process_due_reminders: {
        Args: Record<PropertyKey, never>
        Returns: {
          appointment_id: string
          appointment_type: string
          channel: string
          client_email: string
          client_name: string
          client_phone: string
          pet_name: string
          reminder_id: string
          scheduled_at: string
        }[]
      }
      project_cloudtalk_source: {
        Args: { p_resource_id: string }
        Returns: string
      }
      project_cloudtalk_source_safely: {
        Args: { p_resource_id: string }
        Returns: string
      }
      promote_ezyvet_identity: {
        Args: {
          p_action: string
          p_client_id: string
          p_expected_hash: string
          p_expected_local_version: number
          p_head_version: number
          p_pet_id: string
          p_reason: string
          p_request_id: string
          p_snapshot_id: string
          p_values: Json
        }
        Returns: {
          action: string
          approved_by: string
          client_id: string | null
          created_at: string
          external_id: string
          head_version: number
          id: string
          local_version: number
          pet_id: string | null
          reason: string
          request_hash: string
          request_id: string
          resource: string
          snapshot_id: string
          source_origin: string
          source_site_uid: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_record_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      provider_checkout_context: {
        Args: { p_request_id: string }
        Returns: Json
      }
      provider_refund_context: { Args: { p_request_id: string }; Returns: Json }
      publish_native_estimate: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      purge_expired_frozen_email_payloads: {
        Args: { p_limit?: number }
        Returns: Json
      }
      purge_expired_invoice_email_payloads: {
        Args: { p_limit?: number }
        Returns: number
      }
      purge_expired_release_email_payloads: {
        Args: { p_limit?: number }
        Returns: number
      }
      queue_due_reminders: { Args: { p_limit?: number }; Returns: Json }
      queue_reminder_outbox: {
        Args: { p_job_id: string; p_job_kind: string; p_policy_id: string }
        Returns: {
          approving_actor_id: string | null
          created_at: string
          frozen_context: Json | null
          invalidated_at: string | null
          job_id: string
          job_kind: string
          outbox_id: string | null
          policy_id: string
          policy_version: number
          reason: string | null
          state: string
        }
        SetofOptions: {
          from: "*"
          to: "reminder_outbox_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      read_conversation_email_attachment: {
        Args: {
          p_payload_hash: string
          p_request_id: string
          p_upload_id: string
        }
        Returns: Json
      }
      read_conversation_email_review: {
        Args: { p_request_id: string }
        Returns: Json
      }
      read_conversation_message_attachment: {
        Args: {
          p_message_id: string
          p_payload_hash: string
          p_upload_id: string
        }
        Returns: Json
      }
      read_document_link_artifact: {
        Args: { p_index: number; p_request_id: string }
        Returns: Json
      }
      read_document_link_history: {
        Args: { p_family: string; p_source_id: string }
        Returns: Json
      }
      read_external_record_history: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      read_ezyvet_attachment_chart: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
      }
      read_ezyvet_migration_binding: { Args: { p_id: string }; Returns: Json }
      read_ezyvet_migration_binding_progress: {
        Args: { p_id: string }
        Returns: Json
      }
      read_ezyvet_migration_identity_evidence: {
        Args: {
          p_binding_id: string
          p_evidence_hash: string
          p_page: number
          p_snapshot_id: string
        }
        Returns: Json
      }
      read_ezyvet_migration_resolution: {
        Args: { p_id: string }
        Returns: Json
      }
      read_ezyvet_migration_resolution_context: {
        Args: { p_scope_id: string; p_target: Json }
        Returns: Json
      }
      read_ezyvet_migration_run: { Args: { p_id: string }; Returns: Json }
      read_ezyvet_migration_weight_evidence: {
        Args: {
          p_before_created_at?: string
          p_before_request_id?: string
          p_binding_id: string
          p_evidence_hash: string
          p_limit?: number
          p_page: number
          p_snapshot_id: string
        }
        Returns: Json
      }
      read_frozen_email_payload: {
        Args: { p_lease_token: string; p_outbox_id: string }
        Returns: Json
      }
      read_frozen_email_payload_without_conversation: {
        Args: { p_lease_token: string; p_outbox_id: string }
        Returns: Json
      }
      read_household_360: { Args: { p_client_id: string }; Returns: Json }
      read_invoice_document: {
        Args: { p_client_id: string; p_invoice_id: string }
        Returns: Json
      }
      read_invoice_email_attachment: {
        Args: { p_index: number; p_request_id: string }
        Returns: Json
      }
      read_invoice_email_payload: {
        Args: { p_lease_token: string; p_outbox_id: string }
        Returns: Json
      }
      read_invoice_email_preview: {
        Args: { p_client_id: string; p_invoice_id: string }
        Returns: Json
      }
      read_invoice_payment_state: {
        Args: { p_client_id: string; p_invoice_id: string }
        Returns: Json
      }
      read_lab_result_history: {
        Args: { p_order_id?: string; p_pet_id: string }
        Returns: Json
      }
      read_native_dispense_corrections: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      read_native_dispense_finance: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      read_native_dispense_returns: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      read_native_dispense_returns_v2: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      read_native_estimate_decision_grants: {
        Args: {
          p_before_sequence: number
          p_client_id: string
          p_estimate_id: string
          p_limit: number
        }
        Returns: Json
      }
      read_native_estimate_decision_state: {
        Args: { p_client_id: string; p_estimate_id: string }
        Returns: Json
      }
      read_native_estimate_decisions: {
        Args: {
          p_before_sequence: number
          p_client_id: string
          p_estimate_id: string
          p_limit: number
        }
        Returns: Json
      }
      read_native_estimate_draft: {
        Args: { p_client_id: string; p_id: string }
        Returns: Json
      }
      read_native_estimate_draft_history: {
        Args: {
          p_before_version: number
          p_client_id: string
          p_id: string
          p_limit: number
        }
        Returns: Json
      }
      read_native_estimate_publication: {
        Args: { p_client_id: string; p_estimate_id: string }
        Returns: Json
      }
      read_native_estimate_publication_artifact: {
        Args: {
          p_client_id: string
          p_expected_artifact_hash: string
          p_preparation_id: string
        }
        Returns: Json
      }
      read_native_estimate_publication_history: {
        Args: {
          p_before_version: number
          p_client_id: string
          p_estimate_id: string
          p_limit: number
        }
        Returns: Json
      }
      read_native_estimate_published_revision: {
        Args: { p_client_id: string; p_publication_id: string }
        Returns: Json
      }
      read_native_fulfillment: {
        Args: { p_authorization_id: string; p_pet_id: string }
        Returns: Json
      }
      read_native_prescription_authorization: {
        Args: { p_id: string; p_pet_id: string }
        Returns: Json
      }
      read_native_prescription_draft: {
        Args: { p_id: string; p_pet_id: string }
        Returns: Json
      }
      read_native_prescription_print: {
        Args: { p_authorization_id: string; p_dispense_id?: string }
        Returns: Json
      }
      read_native_prescription_print_v2: {
        Args: { p_authorization_id: string; p_dispense_id?: string }
        Returns: Json
      }
      read_native_prescription_print_v3: {
        Args: { p_authorization_id: string; p_dispense_id?: string }
        Returns: Json
      }
      read_native_prescription_print_v4: {
        Args: { p_authorization_id: string; p_dispense_id?: string }
        Returns: Json
      }
      read_native_prescription_status: {
        Args: { p_authorization_id: string; p_pet_id: string }
        Returns: Json
      }
      read_native_refill: {
        Args: { p_pet_id: string; p_refill_id: string }
        Returns: Json
      }
      read_native_return_intake: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_intake_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      read_native_return_intake_v2: {
        Args: {
          p_authorization_id: string
          p_dispense_id: string
          p_intake_id: string
          p_pet_id: string
        }
        Returns: Json
      }
      read_native_return_policy: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      read_patient_360: { Args: { p_patient_id: string }; Returns: Json }
      read_patient_problem_import_provenance: {
        Args: { p_pet_id: string; p_problem_ids: string[] }
        Returns: Json
      }
      read_patient_treatment_alerts: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      read_payment_collection_status: {
        Args: {
          p_grant_id: string
          p_key_version: string
          p_origin: string
          p_status_token_hash: string
        }
        Returns: Json
      }
      read_payment_reconciliation: {
        Args: { p_case_id: string }
        Returns: Json
      }
      read_record_release: { Args: { p_id: string }; Returns: Json }
      read_release_email_attachment: {
        Args: { p_index: number; p_request_id: string }
        Returns: Json
      }
      read_release_email_payload: {
        Args: { p_lease_token: string; p_outbox_id: string }
        Returns: Json
      }
      read_stripe_event_queue: { Args: { p_limit?: number }; Returns: Json }
      read_stripe_event_queue_page: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_state?: string
        }
        Returns: Json
      }
      read_vaccine_certificate: { Args: { p_id: string }; Returns: Json }
      read_website_inquiry: { Args: { p_id: string }; Returns: Json }
      read_weight_import_provenance: {
        Args: { p_pet_id: string; p_weight_ids: string[] }
        Returns: {
          reviewed_at: string
          reviewed_measurement_date: string
          reviewer_name: string
          source_record_id: string
          source_timestamp: string
          source_unit: string
          source_weight: string
          weight_id: string
        }[]
      }
      receive_communication_event: {
        Args: {
          p_event_id: string
          p_event_type: string
          p_metadata: Json
          p_payload_hash: string
          p_provider: string
          p_resource_id: string
        }
        Returns: {
          attempts: number
          available_at: string
          cycle_attempts: number
          cycle_no: number
          event_id: string
          event_type: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          metadata: NonNullable<Json>
          payload_hash: string
          provider: string
          received_at: string
          resource_id: string
          revision: number
          state: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_provider_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      receive_inventory: {
        Args: {
          p_expires_on: string
          p_id: string
          p_location: string
          p_lot_id: string
          p_lot_number: string
          p_product_id: string
          p_quantity: number
          p_reason: string
        }
        Returns: {
          created_at: string
          created_by: string
          id: string
          kind: string
          lot_id: string
          quantity: number
          reason: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      receive_stripe_event: { Args: { p_receipt: Json }; Returns: string }
      reconcile_communication: {
        Args: {
          p_evidence_reference: string
          p_id: string
          p_outcome: string
          p_provider_message_id: string
        }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reconcile_native_estimate_client_decision: {
        Args: {
          p_close_unrecorded: boolean
          p_id: string
          p_reason: string
          p_request: Json
        }
        Returns: Json
      }
      record_anesthesia_drug_administration: {
        Args: {
          p_id: string
          p_pet_id: string
          p_record_id: string
          p_request: Json
        }
        Returns: {
          administered_at: string
          created_at: string
          created_by: string
          dose: string
          expires_on: string | null
          historical: boolean
          id: string
          invoice_id: string | null
          kind: string
          lot_id: string | null
          lot_number: string
          manufacturer: string
          next_due_on: string | null
          pet_id: string
          product_id: string | null
          product_name: string
          quantity: number
          request: NonNullable<Json>
          route: string
          site: string
          source: string
          veterinarian: string
          veterinarian_license: string
        }
        SetofOptions: {
          from: "*"
          to: "patient_treatments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_communication_delivery: {
        Args: {
          p_event_id: string
          p_outcome: string
          p_provider: string
          p_provider_message_id: string
        }
        Returns: undefined
      }
      record_inbound_sms: {
        Args: {
          p_body: string
          p_from: string
          p_opt_out_type?: string
          p_provider_message_id: string
          p_received_at?: string
          p_to: string
        }
        Returns: {
          client_id: string
          consent_action: string
          conversation_id: string
          message_id: string
        }[]
      }
      record_lesion_observation: {
        Args: {
          p_body_view: string
          p_depth_mm: number
          p_expected_version: number
          p_id: string
          p_label: string
          p_length_mm: number
          p_lesion_id: string
          p_notes: string
          p_observed_at: string
          p_pet_id: string
          p_photo_document_id: string
          p_width_mm: number
          p_x: number
          p_y: number
        }
        Returns: {
          body_view: string
          created_at: string
          created_by: string
          depth_mm: number | null
          id: string
          label: string
          length_mm: number | null
          lesion_id: string
          notes: string
          observed_at: string
          photo_document_id: string | null
          request: NonNullable<Json>
          width_mm: number | null
          x: number
          y: number
        }
        SetofOptions: {
          from: "*"
          to: "patient_lesion_observations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_native_dispense: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      record_native_dispense_finance: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      record_native_dispense_return: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      record_native_dispense_return_v2: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      record_native_estimate_client_decision: {
        Args: {
          p_id: string
          p_key_version: string
          p_origin: string
          p_request: Json
          p_token_hash: string
        }
        Returns: Json
      }
      record_native_estimate_decision_grant: {
        Args: { p_id: string; p_mutation: Json }
        Returns: Json
      }
      record_native_estimate_witnessed_decision: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      record_native_pickup: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      record_native_return_discrepancy: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      record_outbound_delivery_callback: {
        Args: {
          p_error_text?: string
          p_provider: string
          p_provider_message_id: string
          p_recorded_at?: string
          p_status: Database["public"]["Enums"]["outbound_delivery_status"]
          p_status_note?: string
        }
        Returns: {
          accepted_at: string | null
          appointment_reminder_id: string | null
          attempt_count: number
          canceled_at: string | null
          channel: Database["public"]["Enums"]["channel_type"]
          client_id: string | null
          conversation_id: string | null
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error_text: string | null
          lease_owner: string | null
          leased_at: string | null
          leased_until: string | null
          max_attempts: number
          message_id: string | null
          next_attempt_at: string
          payload: NonNullable<Json>
          provider: string | null
          provider_message_id: string | null
          recipient: string
          requested_by: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["outbound_delivery_status"]
          status_note: string | null
          unknown_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "outbound_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_outbound_delivery_result: {
        Args: {
          p_delivery_id: string
          p_error_text?: string
          p_lease_owner: string
          p_next_attempt_at?: string
          p_provider?: string
          p_provider_message_id?: string
          p_recorded_at?: string
          p_status: Database["public"]["Enums"]["outbound_delivery_status"]
          p_status_note?: string
        }
        Returns: {
          accepted_at: string | null
          appointment_reminder_id: string | null
          attempt_count: number
          canceled_at: string | null
          channel: Database["public"]["Enums"]["channel_type"]
          client_id: string | null
          conversation_id: string | null
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error_text: string | null
          lease_owner: string | null
          leased_at: string | null
          leased_until: string | null
          max_attempts: number
          message_id: string | null
          next_attempt_at: string
          payload: NonNullable<Json>
          provider: string | null
          provider_message_id: string | null
          recipient: string
          requested_by: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["outbound_delivery_status"]
          status_note: string | null
          unknown_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "outbound_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_patient_treatment: {
        Args: { p_id: string; p_request: Json }
        Returns: {
          administered_at: string
          created_at: string
          created_by: string
          dose: string
          expires_on: string | null
          historical: boolean
          id: string
          invoice_id: string | null
          kind: string
          lot_id: string | null
          lot_number: string
          manufacturer: string
          next_due_on: string | null
          pet_id: string
          product_id: string | null
          product_name: string
          quantity: number
          request: NonNullable<Json>
          route: string
          site: string
          source: string
          veterinarian: string
          veterinarian_license: string
        }
        SetofOptions: {
          from: "*"
          to: "patient_treatments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_patient_weight: {
        Args: {
          p_measured_at: string
          p_pet_id: string
          p_unit: string
          p_weight: number
        }
        Returns: {
          created_at: string
          id: string
          measured_at: string
          pet_id: string
          recorded_by: string
          unit: string
          weight: number
        }
        SetofOptions: {
          from: "*"
          to: "patient_weights"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_payment_reconciliation: {
        Args: { p_family: string; p_reason: string; p_request_id: string }
        Returns: {
          created_at: string
          family: string
          id: string
          invoice_id: string
          reason: string
          request_id: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_reconciliation_observations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_sms_consent: {
        Args: {
          p_actor_id: string
          p_client_id: string
          p_details: string
          p_expected_updated_at?: string
          p_method: Database["public"]["Enums"]["consent_method"]
          p_opted_in: boolean
          p_phone: string
        }
        Returns: {
          client_id: string
          consent_details: string | null
          consent_method: Database["public"]["Enums"]["consent_method"] | null
          created_at: string
          id: string
          opted_in: boolean
          opted_in_at: string | null
          opted_out_at: string | null
          phone_number: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sms_consent"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recover_communication_event_retry: {
        Args: { p_id: string }
        Returns: {
          actor_id: string
          created_at: string
          cycle_no: number
          event_id: string
          expected_work_hash: string
          id: string
          lifetime_attempts: number
          previous_cycle_no: number
          reason: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_event_retry_actions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recover_document_link: {
        Args: { p_family: string; p_request_id?: string; p_source_id: string }
        Returns: Json
      }
      recover_document_link_without_receipt: {
        Args: { p_family: string; p_request_id?: string; p_source_id: string }
        Returns: Json
      }
      recover_external_record_acknowledgment: {
        Args: { p_id: string }
        Returns: {
          actor_id: string
          capture_hash: string
          created_at: string
          document_version: number
          id: string
          record_id: string
        }
        SetofOptions: {
          from: "*"
          to: "external_record_acknowledgments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recover_external_record_receipt: {
        Args: { p_receipt_id: string }
        Returns: Json
      }
      recover_ezyvet_attachment_approval: {
        Args: {
          p_capture_hash: string
          p_id: string
          p_pet_id: string
          p_request_id: string
        }
        Returns: Json
      }
      recover_ezyvet_attachment_capture: {
        Args: { p_animal_link_id: string; p_id: string }
        Returns: Json
      }
      recover_ezyvet_attachment_record: {
        Args: { p_id: string; p_pet_id: string }
        Returns: {
          actor_id: string
          animal_link_id: string
          attachment_external_id: string
          capture_hash: string
          created_at: string
          entry_method: string
          id: string
          pet_id: string
          previous_record_id: string | null
          record_hash: string
          request_hash: string
          request_id: string
          review_reason: string
          source_context: NonNullable<Json>
          source_origin: string
          source_site_uid: string
          title: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_attachment_record_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recover_ezyvet_attachment_run: {
        Args: { p_animal_link_id: string; p_id: string }
        Returns: Json
      }
      recover_ezyvet_clinical_run: {
        Args: { p_animal_link_id: string; p_id: string; p_resource: string }
        Returns: Json
      }
      recover_ezyvet_history_request: {
        Args: { p_id: string; p_kind: string; p_pet_id: string }
        Returns: Json
      }
      recover_ezyvet_prescription_review: {
        Args: { p_id: string; p_pet_id: string }
        Returns: Json
      }
      recover_ezyvet_prescription_run: {
        Args: { p_animal_link_id: string; p_id: string; p_resource: string }
        Returns: Json
      }
      recover_ezyvet_prescriptionitem_run: {
        Args: {
          p_animal_link_id: string
          p_id: string
          p_prescription_observed_head_version: number
          p_prescription_payload_hash: string
          p_prescription_snapshot_id: string
        }
        Returns: Json
      }
      recover_ezyvet_vaccination_review: {
        Args: { p_id: string; p_pet_id: string }
        Returns: Json
      }
      recover_ezyvet_vaccination_run: {
        Args: {
          p_animal_link_id: string
          p_consult_observed_head_version: number
          p_consult_payload_hash: string
          p_consult_snapshot_id: string
          p_id: string
        }
        Returns: Json
      }
      recover_invoice_email: {
        Args: { p_invoice_id: string; p_request_id?: string }
        Returns: Json
      }
      recover_lab_report_receipt: {
        Args: { p_receipt_id: string }
        Returns: Json
      }
      recover_message_request: {
        Args: { p_actor_id: string; p_request_id?: string; p_scope: string }
        Returns: Json
      }
      recover_native_dispense_correction: {
        Args: { p_id: string }
        Returns: Json
      }
      recover_native_dispense_finance: { Args: { p_id: string }; Returns: Json }
      recover_native_dispense_return: { Args: { p_id: string }; Returns: Json }
      recover_native_dispense_return_v2: {
        Args: { p_id: string }
        Returns: Json
      }
      recover_native_estimate_client_decision: {
        Args: {
          p_id: string
          p_key_version: string
          p_origin: string
          p_request: Json
          p_token_hash: string
        }
        Returns: Json
      }
      recover_native_estimate_decision_grant: {
        Args: { p_id: string }
        Returns: Json
      }
      recover_native_estimate_draft: { Args: { p_id: string }; Returns: Json }
      recover_native_estimate_preparation: {
        Args: { p_id: string }
        Returns: Json
      }
      recover_native_estimate_publication_operation: {
        Args: { p_id: string }
        Returns: Json
      }
      recover_native_estimate_witnessed_decision: {
        Args: { p_id: string }
        Returns: Json
      }
      recover_native_fulfillment_operation: {
        Args: { p_id: string }
        Returns: Json
      }
      recover_native_prescription_operation: {
        Args: { p_id: string }
        Returns: Json
      }
      recover_native_refill_operation: { Args: { p_id: string }; Returns: Json }
      recover_native_return_discrepancy: {
        Args: { p_id: string }
        Returns: Json
      }
      recover_native_return_policy: { Args: { p_id: string }; Returns: Json }
      recover_outbox_retry: { Args: { p_id: string }; Returns: Json }
      recover_payment_collection: {
        Args: { p_invoice_id: string; p_request_id?: string }
        Returns: Json
      }
      recover_payment_delivery: {
        Args: { p_request_id: string }
        Returns: Json
      }
      recover_release_email: {
        Args: { p_release_id: string; p_request_id?: string }
        Returns: Json
      }
      recover_reminder_scheduler_run: {
        Args: { p_run_id: string }
        Returns: Json
      }
      redact_private_capabilities: { Args: { p_text: string }; Returns: string }
      redact_stored_cloudtalk_capabilities: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      refund_payment_context: {
        Args: { p_actor_id: string; p_request_id: string }
        Returns: Json
      }
      refund_state_internal: { Args: { p_request_id: string }; Returns: string }
      release_api_attachment_document: {
        Args: { p_source: Json }
        Returns: Json
      }
      release_communication_claim: {
        Args: { p_error_code: string; p_id: string; p_lease_token: string }
        Returns: undefined
      }
      release_communication_event: {
        Args: {
          p_error: string
          p_id: string
          p_lease_token: string
          p_review?: boolean
        }
        Returns: undefined
      }
      release_communication_event_outcome: {
        Args: {
          p_error: string
          p_id: string
          p_lease_token: string
          p_review?: boolean
        }
        Returns: Json
      }
      release_document_has_provenance: {
        Args: { p_document_id: string }
        Returns: boolean
      }
      release_email_capture_context: {
        Args: { p_actor_id: string; p_request_id: string }
        Returns: Json
      }
      release_email_context: { Args: { p_request_id: string }; Returns: Json }
      release_imported_history_refs: {
        Args: { p_refs: Json; p_selection: Json }
        Returns: Json
      }
      release_native_prescription: {
        Args: { p_client_id: string; p_id: string; p_pet_id: string }
        Returns: Json
      }
      release_preview_internal: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      release_preview_v10_internal: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      release_preview_v11_internal: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      release_preview_v12_internal: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      release_preview_v13_internal: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      release_preview_v3_internal: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      release_preview_v5_internal: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      release_preview_v6_internal: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      release_preview_v7_internal: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      release_preview_v8_internal: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      release_preview_v9_internal: {
        Args: {
          p_channel: string
          p_client_id: string
          p_pet_id: string
          p_recipient: string
          p_selection: Json
        }
        Returns: Json
      }
      release_problem_fields: { Args: { p: Json }; Returns: Json }
      release_problem_has_import_provenance: {
        Args: { p_id: string }
        Returns: boolean
      }
      release_provenance_candidates_internal: {
        Args: {
          p_family: string
          p_limit: number
          p_offset: number
          p_pet_id: string
        }
        Returns: Json[]
      }
      release_read_internal: { Args: { p_id: string }; Returns: Json }
      release_source_provenance_internal: {
        Args: { p_family: string; p_id: string; p_pet_id: string }
        Returns: Json
      }
      reminder_delivery_context: {
        Args: { p_job_id: string; p_job_kind: string; p_policy_id: string }
        Returns: Json
      }
      reminder_scheduler_candidates_internal: {
        Args: Record<PropertyKey, never>
        Returns: {
          job_id: string
          job_kind: string
          policy_id: string
          source_id: string
          source_kind: string
          source_version: number
          template_id: string
          template_version: number
        }[]
      }
      replace_native_prescription: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      requeue_communication_event: {
        Args: {
          p_attest: boolean
          p_event_id: string
          p_expected_work_hash: string
          p_id: string
          p_reason: string
        }
        Returns: {
          actor_id: string
          created_at: string
          cycle_no: number
          event_id: string
          expected_work_hash: string
          id: string
          lifetime_attempts: number
          previous_cycle_no: number
          reason: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_event_retry_actions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      requeue_outbox_retry: {
        Args: {
          p_attest: boolean
          p_expected_work_hash: string
          p_id: string
          p_outbox_id: string
          p_reason: string
        }
        Returns: Json
      }
      requeue_stripe_event: {
        Args: {
          p_attest: boolean
          p_expected_work_hash: string
          p_reason: string
          p_receipt_id: string
          p_resolution_id: string
        }
        Returns: Json
      }
      reserve_ezyvet_attachment_original: {
        Args: {
          p_actor: string
          p_after_raw_sha256: string
          p_before_raw_sha256: string
          p_content_sha256: string
          p_file_size: number
          p_id: string
          p_lease_id: string
          p_mime_type: string
        }
        Returns: Json
      }
      resolve_ezyvet_weight_request: {
        Args: {
          p_discard: boolean
          p_request_id: string
          p_snapshot_id: string
        }
        Returns: Json
      }
      resolve_message_request: {
        Args: {
          p_abandon?: boolean
          p_actor_id: string
          p_request_id: string
          p_scope: string
        }
        Returns: Json
      }
      retrieve_document_link: {
        Args: { p_artifact_index?: number; p_id: string; p_token_hash: string }
        Returns: Json
      }
      retrieve_native_estimate_decision: {
        Args: {
          p_grant_id: string
          p_key_version: string
          p_origin: string
          p_token_hash: string
        }
        Returns: Json
      }
      retry_cloudtalk_projections: {
        Args: { p_limit?: number }
        Returns: {
          projected: number
          still_failing: number
        }[]
      }
      retry_communication: {
        Args: { p_actor_id: string; p_id: string }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retry_outbound_delivery: {
        Args: {
          p_delivery_id: string
          p_expected_updated_at?: string
          p_requested_at?: string
        }
        Returns: {
          accepted_at: string | null
          appointment_reminder_id: string | null
          attempt_count: number
          canceled_at: string | null
          channel: Database["public"]["Enums"]["channel_type"]
          client_id: string | null
          conversation_id: string | null
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error_text: string | null
          lease_owner: string | null
          leased_at: string | null
          leased_until: string | null
          max_attempts: number
          message_id: string | null
          next_attempt_at: string
          payload: NonNullable<Json>
          provider: string | null
          provider_message_id: string | null
          recipient: string
          requested_by: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["outbound_delivery_status"]
          status_note: string | null
          unknown_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "outbound_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retry_stripe_event: {
        Args: { p_lease_token: string; p_reason: string; p_receipt_id: string }
        Returns: string
      }
      revalidate_abandoned_attachment_cleanup: {
        Args: { p_id: string; p_token: string }
        Returns: Json
      }
      review_ezyvet_snapshot: {
        Args: {
          p_client_id: string
          p_decision: string
          p_pet_id: string
          p_reason: string
          p_snapshot_id: string
        }
        Returns: {
          client_id: string | null
          created_at: string
          decision: string
          id: string
          pet_id: string | null
          reason: string
          reviewed_by: string
          snapshot_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_ezyvet_snapshot_pre_attachment: {
        Args: {
          p_client_id: string
          p_decision: string
          p_pet_id: string
          p_reason: string
          p_snapshot_id: string
        }
        Returns: {
          client_id: string | null
          created_at: string
          decision: string
          id: string
          pet_id: string | null
          reason: string
          reviewed_by: string
          snapshot_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_ezyvet_weight_change: {
        Args: {
          p_approval_id: string
          p_head_version: number
          p_reason: string
          p_request_id: string
          p_snapshot_id: string
        }
        Returns: {
          approval_id: string
          created_at: string
          head_version: number
          reason: string
          request_id: string
          reviewed_by: string
          snapshot_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_weight_source_reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_lab_order_source: {
        Args: {
          p_attest: boolean
          p_expected_order_version: number
          p_id: string
          p_order_id: string
          p_pet_id: string
          p_previous_review_id: string
          p_review_reason: string
          p_source_account_id: string
          p_source_order_reference: string
          p_source_patient_reference: string
        }
        Returns: {
          actor_id: string
          created_at: string
          id: string
          order_id: string
          order_version: number
          pet_id: string
          previous_review_id: string | null
          review_reason: string
          revision: number
          source_account_id: string
          source_order_reference: string
          source_patient_reference: string
        }
        SetofOptions: {
          from: "*"
          to: "lab_order_source_reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_lab_source_account: {
        Args: {
          p_account_reference: string
          p_environment_label: string
          p_id: string
          p_provider_label: string
          p_review_note: string
        }
        Returns: {
          account_reference: string
          actor_id: string
          created_at: string
          environment_label: string
          id: string
          manual_import_enabled: boolean
          provider_label: string
          review_note: string
          transport_enabled: boolean
        }
        SetofOptions: {
          from: "*"
          to: "lab_source_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_website_inquiry_household: {
        Args: {
          p_actor_id: string
          p_channel: string
          p_client_id: string
          p_confirmed: boolean
          p_evidence: string
          p_expected_version: number
          p_id: string
          p_recipient: string
        }
        Returns: {
          assigned_to_id: string | null
          client_id: string | null
          inquiry_id: string
          reply_channel: string | null
          reply_recipient: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "website_inquiry_triage"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_document_link: {
        Args: { p_reason: string; p_request_id: string }
        Returns: undefined
      }
      revoke_payment_collection: {
        Args: { p_reason: string; p_request_id: string }
        Returns: Json
      }
      save_appointment:
        | {
            Args: {
              p_actor_id: string
              p_address_snapshot: string
              p_appointment_type: string
              p_assigned_dvm_id: string
              p_client_id: string
              p_duration_minutes: number
              p_expected_version: number
              p_id: string
              p_notes: string
              p_pet_id: string
              p_reminder_offsets: number[]
              p_resource_name: string
              p_scheduled_at: string
              p_status: Database["public"]["Enums"]["appointment_status"]
              p_travel_after_minutes: number
              p_travel_before_minutes: number
              p_visit_type: string
            }
            Returns: {
              address_snapshot: string
              appointment_type: string
              assigned_dvm_id: string | null
              client_id: string
              created_at: string
              created_by: string | null
              duration_minutes: number
              ezyvet_appointment_id: string | null
              id: string
              notes: string | null
              pet_id: string | null
              reminder_offsets: number[]
              resource_name: string | null
              scheduled_at: string
              status: Database["public"]["Enums"]["appointment_status"]
              travel_after_minutes: number
              travel_before_minutes: number
              updated_at: string
              updated_by: string | null
              version: number
              visit_type: string
            }
            SetofOptions: {
              from: "*"
              to: "appointments"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_appointment_type: string
              p_assigned_dvm_id: string
              p_client_id: string
              p_duration_minutes: number
              p_expected_version: number
              p_id: string
              p_notes: string
              p_pet_id: string
              p_scheduled_at: string
              p_status: Database["public"]["Enums"]["appointment_status"]
            }
            Returns: {
              address_snapshot: string
              appointment_type: string
              assigned_dvm_id: string | null
              client_id: string
              created_at: string
              created_by: string | null
              duration_minutes: number
              ezyvet_appointment_id: string | null
              id: string
              notes: string | null
              pet_id: string | null
              reminder_offsets: number[]
              resource_name: string | null
              scheduled_at: string
              status: Database["public"]["Enums"]["appointment_status"]
              travel_after_minutes: number
              travel_before_minutes: number
              updated_at: string
              updated_by: string | null
              version: number
              visit_type: string
            }
            SetofOptions: {
              from: "*"
              to: "appointments"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      save_care_message_template: {
        Args: {
          p_active: boolean
          p_body: string
          p_channel: string
          p_days_before: number
          p_expected_version: number
          p_id: string
          p_name: string
          p_review_note: string
        }
        Returns: {
          active: boolean
          body: string
          channel: string
          days_before: number
          id: string
          name: string
          review_note: string
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "care_message_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_catalog_product: {
        Args: {
          p_active: boolean
          p_expected_version: number
          p_id: string
          p_kind: string
          p_manufacturer: string
          p_name: string
          p_unit: string
          p_unit_price_cents: number
        }
        Returns: {
          active: boolean
          created_at: string
          created_by: string
          id: string
          kind: string
          manufacturer: string
          name: string
          unit: string
          unit_price_cents: number
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "catalog_products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_catalog_vaccine_profile: {
        Args: {
          p_default_booster_interval_days: number
          p_expected_version: number
          p_group_key: string
          p_labeled_duration: string
          p_product_id: string
          p_review_note: string
          p_species: string[]
          p_vaccine_type: string
        }
        Returns: {
          default_booster_interval_days: number | null
          group_key: string | null
          id: string
          labeled_duration: string | null
          product_id: string
          review_note: string
          species: string[]
          updated_at: string
          updated_by: string
          vaccine_type: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "catalog_vaccine_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_client: {
        Args: {
          p_actor_id: string
          p_client_id: string
          p_expected_version: number
          p_first_name: string
          p_housecall_address: string
          p_last_name: string
          p_mailing_address: string
          p_preferred_channel: Database["public"]["Enums"]["channel_type"]
          p_primary_email: string
          p_primary_phone: string
        }
        Returns: {
          created_at: string
          ezyvet_id: string | null
          first_name: string
          full_name: string
          housecall_address: string | null
          id: string
          last_name: string
          mailing_address: string | null
          preferred_channel: Database["public"]["Enums"]["channel_type"] | null
          primary_email: string | null
          primary_phone: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_clinical_encounter: {
        Args: {
          p_assessment: string
          p_expected_version: number
          p_id: string
          p_location: string
          p_objective: string
          p_pet_id: string
          p_plan: string
          p_subjective: string
          p_visit_at: string
          p_visit_type: string
        }
        Returns: {
          assessment: string
          created_at: string
          created_by: string
          id: string
          location: string
          objective: string
          pet_id: string
          plan: string
          signed_at: string | null
          signed_by: string | null
          status: string
          subjective: string
          updated_at: string
          updated_by: string
          version: number
          visit_at: string
          visit_type: string
        }
        SetofOptions: {
          from: "*"
          to: "clinical_encounters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_dental_chart: {
        Args: {
          p_dentition: string
          p_expected_version: number
          p_id: string
          p_notes: string
          p_pet_id: string
          p_teeth: Json
          p_visit_at: string
        }
        Returns: {
          created_at: string
          created_by: string
          dentition: string
          id: string
          notes: string
          pet_id: string
          signed_at: string | null
          signed_by: string | null
          species_family: string
          status: string
          teeth: NonNullable<Json>
          updated_at: string
          updated_by: string
          version: number
          visit_at: string
        }
        SetofOptions: {
          from: "*"
          to: "dental_charts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_ezyvet_migration_resolution: {
        Args: {
          p_action: string
          p_expected_context_hash: string
          p_id: string
          p_reason: string
          p_replaces_id?: string
          p_scope_id: string
          p_target: Json
        }
        Returns: Json
      }
      save_lab_due_template: {
        Args: {
          p_active: boolean
          p_expected_version: number
          p_id: string
          p_interval_days: number
          p_name: string
          p_review_note: string
        }
        Returns: {
          active: boolean
          id: string
          interval_days: number
          name: string
          review_note: string
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "lab_due_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_native_estimate_draft: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      save_native_prescription_draft: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      save_patient: {
        Args: {
          p_archived_at: string
          p_birth_date_precision: string
          p_breed: string
          p_client_id: string
          p_color: string
          p_deceased_at: string
          p_dob: string
          p_expected_version: number
          p_id: string
          p_microchip_id: string
          p_name: string
          p_neuter_status: string
          p_sex: string
          p_species: string
        }
        Returns: {
          allergies: string | null
          archived_at: string | null
          birth_date_precision: string
          breed: string | null
          client_id: string
          color: string | null
          created_at: string
          deceased_at: string | null
          dob: string | null
          id: string
          last_visit_at: string | null
          medications: string | null
          microchip_id: string | null
          name: string
          neuter_status: string
          sex: string
          species: string
          vaccination_notes: string | null
          version: number
          weight_lbs: number | null
        }
        SetofOptions: {
          from: "*"
          to: "pets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_patient_anesthesia_record: {
        Args: {
          p_expected_version: number
          p_id: string
          p_pet_id: string
          p_values: Json
        }
        Returns: {
          assessment: string
          created_at: string
          created_by: string
          ended_at: string | null
          events: NonNullable<Json>
          id: string
          observations: NonNullable<Json>
          original_document_id: string | null
          pet_id: string
          plan: string
          procedure_name: string
          recovery_notes: string
          signed_at: string | null
          signed_by: string | null
          source: string
          source_description: string
          started_at: string
          status: string
          team: string
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "patient_anesthesia_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_patient_lab_order: {
        Args: {
          p_correction_reason: string
          p_expected_version: number
          p_id: string
          p_pet_id: string
          p_values: Json
        }
        Returns: {
          accession: string
          collected_date: string | null
          created_at: string
          created_by: string
          due_date: string | null
          id: string
          interval_anchor: string | null
          interval_days: number | null
          notes: string
          override_reason: string
          pet_id: string
          reminders_enabled: boolean
          result_date: string | null
          result_document_id: string | null
          status: string
          template_id: string | null
          template_version: number | null
          test_name: string
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "patient_lab_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_patient_problem: {
        Args: {
          p_expected_version: number
          p_id: string
          p_importance: string
          p_notes: string
          p_onset_date: string
          p_pet_id: string
          p_status: string
          p_title: string
        }
        Returns: {
          created_at: string
          created_by: string
          id: string
          importance: string
          notes: string
          onset_date: string | null
          pet_id: string
          status: string
          title: string
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "patient_problems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_patient_qol: {
        Args: {
          p_appetite: string
          p_comfort: string
          p_drinking: string
          p_expected_version: number
          p_good_days: string
          p_id: string
          p_mobility: string
          p_notes: string
          p_observed_at: string
          p_observer: string
          p_pet_id: string
          p_social_engagement: string
        }
        Returns: {
          appetite: string
          comfort: string
          created_at: string
          created_by: string
          drinking: string
          good_days: string
          id: string
          mobility: string
          notes: string
          observed_at: string
          observer: string
          pet_id: string
          signed_at: string | null
          signed_by: string | null
          social_engagement: string
          status: string
          template_version: string
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "patient_qol_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_patient_qol_scale: {
        Args: {
          p_assessed_at: string
          p_assessor: string
          p_expected_version: number
          p_happiness: number
          p_happiness_note: string
          p_hunger: number
          p_hunger_note: string
          p_hurt: number
          p_hurt_note: string
          p_hydration: number
          p_hydration_note: string
          p_hygiene: number
          p_hygiene_note: string
          p_id: string
          p_mobility: number
          p_mobility_note: string
          p_more_good_days: number
          p_more_good_days_note: string
          p_notes: string
          p_pet_id: string
        }
        Returns: {
          assessed_at: string
          assessor: string
          created_at: string
          created_by: string
          happiness: number | null
          happiness_note: string
          hunger: number | null
          hunger_note: string
          hurt: number | null
          hurt_note: string
          hydration: number | null
          hydration_note: string
          hygiene: number | null
          hygiene_note: string
          id: string
          mobility: number | null
          mobility_note: string
          more_good_days: number | null
          more_good_days_note: string
          notes: string
          pet_id: string
          scale_version: string
          signed_at: string | null
          signed_by: string | null
          status: string
          total: number | null
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "patient_qol_scale_assessments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_patient_vaccine_due_plan: {
        Args: {
          p_anchor_source: string
          p_current_due_on: string
          p_expected_version: number
          p_id: string
          p_interval_days: number
          p_last_administered_on: string
          p_override_reason: string
          p_pet_id: string
          p_product_id: string
          p_reminders_enabled: boolean
          p_review_note: string
          p_status: string
          p_template_id: string
          p_template_version: number
          p_treatment_id: string
        }
        Returns: {
          anchor_source: string
          created_at: string
          created_by: string
          current_due_on: string
          group_key: string
          id: string
          interval_days: number
          last_administered_on: string
          override_reason: string
          pet_id: string
          product_id: string
          proposed_due_on: string
          reminders_enabled: boolean
          review_note: string
          status: string
          template_id: string
          template_snapshot: NonNullable<Json>
          template_version: number
          treatment_id: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "patient_vaccine_due_plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_qol_scale_reference: {
        Args: {
          p_enabled: boolean
          p_expected_version: number
          p_reference_label: string
          p_reference_total: number
          p_review_note: string
        }
        Returns: {
          enabled: boolean
          id: string
          reference_label: string
          reference_total: number | null
          review_note: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "qol_scale_reference_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_reminder_automation_policy: {
        Args: {
          p_channel: string
          p_enabled: boolean
          p_expected_version: number
          p_id: string
          p_message_template_id: string
          p_message_template_version: number
          p_review_note: string
          p_source_kind: string
          p_subject: string
        }
        Returns: {
          approved_at: string
          approved_by: string
          channel: string
          enabled: boolean
          id: string
          message_template_id: string
          message_template_version: number
          review_note: string
          source_kind: string
          subject: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "reminder_automation_policies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_vaccine_due_template: {
        Args: {
          p_active: boolean
          p_expected_version: number
          p_group_key: string
          p_id: string
          p_interval_days: number
          p_name: string
          p_product_ids: string[]
          p_review_note: string
        }
        Returns: {
          active: boolean
          group_key: string
          id: string
          interval_days: number
          name: string
          product_ids: string[]
          review_note: string
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "vaccine_due_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      schedule_clinicians: {
        Args: Record<PropertyKey, never>
        Returns: {
          full_name: string
          id: string
        }[]
      }
      scheduler_dispatch: { Args: { p_job: string }; Returns: Json }
      scheduler_reconcile: { Args: Record<PropertyKey, never>; Returns: number }
      scheduler_run_projection_internal: {
        Args: { p_run_id: string }
        Returns: Json
      }
      search_clients: {
        Args: { p_limit?: number; p_search: string }
        Returns: {
          created_at: string
          ezyvet_id: string | null
          first_name: string
          full_name: string
          housecall_address: string | null
          id: string
          last_name: string
          mailing_address: string | null
          preferred_channel: Database["public"]["Enums"]["channel_type"] | null
          primary_email: string | null
          primary_phone: string | null
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_ezyvet_mapped_patients: {
        Args: { p_limit?: number; p_search: string }
        Returns: {
          external_id: string
          household_name: string
          link_id: string
          patient_name: string
          patient_version: number
          pet_id: string
          source_origin: string
          source_site_uid: string
        }[]
      }
      search_ezyvet_weight_patients: {
        Args: { p_limit?: number; p_search: string }
        Returns: {
          external_id: string
          household_name: string
          link_id: string
          patient_name: string
          patient_version: number
          pet_id: string
          source_origin: string
          source_site_uid: string
        }[]
      }
      search_inventory_products: {
        Args: { p_limit?: number; p_search?: string }
        Returns: {
          active: boolean
          created_at: string
          created_by: string
          id: string
          kind: string
          manufacturer: string
          name: string
          unit: string
          unit_price_cents: number
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "catalog_products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_patient_problems: {
        Args: { p_limit?: number; p_pet_id: string; p_search: string }
        Returns: {
          created_at: string
          created_by: string
          id: string
          importance: string
          notes: string
          onset_date: string | null
          pet_id: string
          status: string
          title: string
          updated_at: string
          updated_by: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "patient_problems"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      select_all_record_release_sources: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      select_all_record_release_sources_v10: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      select_all_record_release_sources_v11: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      select_all_record_release_sources_v12: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      select_all_record_release_sources_v13: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      select_all_record_release_sources_v5: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      select_all_record_release_sources_v6: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      select_all_record_release_sources_v7: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      select_all_record_release_sources_v8: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      select_all_record_release_sources_v9: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      sign_clinical_encounter: {
        Args: { p_expected_version: number; p_id: string }
        Returns: {
          assessment: string
          created_at: string
          created_by: string
          id: string
          location: string
          objective: string
          pet_id: string
          plan: string
          signed_at: string | null
          signed_by: string | null
          status: string
          subjective: string
          updated_at: string
          updated_by: string
          version: number
          visit_at: string
          visit_type: string
        }
        SetofOptions: {
          from: "*"
          to: "clinical_encounters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sign_dental_chart: {
        Args: { p_expected_version: number; p_id: string; p_pet_id: string }
        Returns: {
          created_at: string
          created_by: string
          dentition: string
          id: string
          notes: string
          pet_id: string
          signed_at: string | null
          signed_by: string | null
          species_family: string
          status: string
          teeth: NonNullable<Json>
          updated_at: string
          updated_by: string
          version: number
          visit_at: string
        }
        SetofOptions: {
          from: "*"
          to: "dental_charts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sign_native_prescription: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      sign_patient_anesthesia_record: {
        Args: { p_expected_version: number; p_id: string; p_pet_id: string }
        Returns: {
          assessment: string
          created_at: string
          created_by: string
          ended_at: string | null
          events: NonNullable<Json>
          id: string
          observations: NonNullable<Json>
          original_document_id: string | null
          pet_id: string
          plan: string
          procedure_name: string
          recovery_notes: string
          signed_at: string | null
          signed_by: string | null
          source: string
          source_description: string
          started_at: string
          status: string
          team: string
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "patient_anesthesia_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sign_patient_qol: {
        Args: { p_expected_version: number; p_id: string }
        Returns: {
          appetite: string
          comfort: string
          created_at: string
          created_by: string
          drinking: string
          good_days: string
          id: string
          mobility: string
          notes: string
          observed_at: string
          observer: string
          pet_id: string
          signed_at: string | null
          signed_by: string | null
          social_engagement: string
          status: string
          template_version: string
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "patient_qol_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sign_patient_qol_scale: {
        Args: { p_expected_version: number; p_id: string }
        Returns: {
          assessed_at: string
          assessor: string
          created_at: string
          created_by: string
          happiness: number | null
          happiness_note: string
          hunger: number | null
          hunger_note: string
          hurt: number | null
          hurt_note: string
          hydration: number | null
          hydration_note: string
          hygiene: number | null
          hygiene_note: string
          id: string
          mobility: number | null
          mobility_note: string
          more_good_days: number | null
          more_good_days_note: string
          notes: string
          pet_id: string
          scale_version: string
          signed_at: string | null
          signed_by: string | null
          status: string
          total: number | null
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "patient_qol_scale_assessments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sms_apply_start_keyword_internal: {
        Args: {
          p_note?: string
          p_occurred_at: string
          p_provider: string
          p_provider_message_id: string
          p_recipient: string
        }
        Returns: boolean
      }
      sms_keyword: { Args: { p_body: string }; Returns: string }
      sms_lift_opt_out_internal: {
        Args: {
          p_actor_id: string
          p_client_id: string
          p_note?: string
          p_occurred_at: string
          p_provider: string
          p_provider_message_id: string
          p_recipient: string
          p_source: string
        }
        Returns: boolean
      }
      sms_reconcile_opt_outs_internal: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      sms_record_opt_out_internal: {
        Args: {
          p_actor_id: string
          p_client_id: string
          p_occurred_at: string
          p_provider: string
          p_provider_message_id: string
          p_reason: string
          p_recipient: string
          p_source: string
        }
        Returns: boolean
      }
      stage_external_record_receipt: {
        Args: {
          p_animal_link_id: string
          p_document_id: string
          p_document_version: number
          p_expected_pet_version: number
          p_export_reference: string
          p_id: string
          p_previous_record_id: string
          p_received_at: string
          p_review_reason: string
        }
        Returns: {
          actor_id: string
          animal_link_id: string
          created_at: string
          document_id: string
          document_version: number
          entry_method: string
          export_reference: string
          file_size: number
          id: string
          mime_type: string
          pet_id: string
          pet_version: number
          previous_record_id: string | null
          receipt_hash: string
          received_at: string
          review_reason: string
          source_animal_id: string
          source_origin: string
          source_site_uid: string
        }
        SetofOptions: {
          from: "*"
          to: "external_record_receipts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stage_ezyvet_attachment_page: {
        Args: {
          p_actor: string
          p_lease_id: string
          p_page: Json
          p_run_id: string
        }
        Returns: {
          created_at: string
          id: string
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          next_page: number
          requested_by: string
          resource: string
          retry_after: string | null
          source_origin: string
          source_site_uid: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stage_ezyvet_import_page: {
        Args: {
          p_actor: string
          p_complete: boolean
          p_id: string
          p_items: Json
          p_lease_id: string
          p_page: number
        }
        Returns: {
          created_at: string
          id: string
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          next_page: number
          requested_by: string
          resource: string
          retry_after: string | null
          source_origin: string
          source_site_uid: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stage_ezyvet_import_page_core: {
        Args: {
          p_actor: string
          p_complete: boolean
          p_id: string
          p_items: Json
          p_lease_id: string
          p_page: number
        }
        Returns: {
          created_at: string
          id: string
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          next_page: number
          requested_by: string
          resource: string
          retry_after: string | null
          source_origin: string
          source_site_uid: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stage_ezyvet_import_page_pre_attachment: {
        Args: {
          p_actor: string
          p_complete: boolean
          p_id: string
          p_items: Json
          p_lease_id: string
          p_page: number
        }
        Returns: {
          created_at: string
          id: string
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          next_page: number
          requested_by: string
          resource: string
          retry_after: string | null
          source_origin: string
          source_site_uid: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stage_ezyvet_import_page_pre_clinical: {
        Args: {
          p_actor: string
          p_complete: boolean
          p_id: string
          p_items: Json
          p_lease_id: string
          p_page: number
        }
        Returns: {
          created_at: string
          id: string
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          next_page: number
          requested_by: string
          resource: string
          retry_after: string | null
          source_origin: string
          source_site_uid: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stage_ezyvet_import_page_pre_prescription: {
        Args: {
          p_actor: string
          p_complete: boolean
          p_id: string
          p_items: Json
          p_lease_id: string
          p_page: number
        }
        Returns: {
          created_at: string
          id: string
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          next_page: number
          requested_by: string
          resource: string
          retry_after: string | null
          source_origin: string
          source_site_uid: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stage_ezyvet_import_page_pre_prescriptionitem: {
        Args: {
          p_actor: string
          p_complete: boolean
          p_id: string
          p_items: Json
          p_lease_id: string
          p_page: number
        }
        Returns: {
          created_at: string
          id: string
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          next_page: number
          requested_by: string
          resource: string
          retry_after: string | null
          source_origin: string
          source_site_uid: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stage_ezyvet_import_page_pre_vaccination: {
        Args: {
          p_actor: string
          p_complete: boolean
          p_id: string
          p_items: Json
          p_lease_id: string
          p_page: number
        }
        Returns: {
          created_at: string
          id: string
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          next_page: number
          requested_by: string
          resource: string
          retry_after: string | null
          source_origin: string
          source_site_uid: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ezyvet_import_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stage_lab_report_receipt: {
        Args: {
          p_document_id: string
          p_document_version: number
          p_id: string
          p_received_at: string
          p_source_account_id: string
          p_source_order_reference: string
          p_source_patient_reference: string
          p_source_report_reference: string
        }
        Returns: {
          actor_id: string
          created_at: string
          document_id: string
          document_version: number
          entry_method: string
          file_size: number
          id: string
          mime_type: string
          pet_id: string
          receipt_hash: string
          received_at: string
          source_account_id: string
          source_order_reference: string
          source_patient_reference: string
          source_report_reference: string
        }
        SetofOptions: {
          from: "*"
          to: "lab_report_receipts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_communication_attempt: {
        Args: { p_id: string; p_lease_token: string; p_provider_config: Json }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_communication_attempt_without_conversation: {
        Args: { p_id: string; p_lease_token: string; p_provider_config: Json }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_communication_attempt_without_document_link_guard: {
        Args: { p_id: string; p_lease_token: string; p_provider_config: Json }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_communication_attempt_without_invoice_guard: {
        Args: { p_id: string; p_lease_token: string; p_provider_config: Json }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_communication_attempt_without_payment_delivery_guard: {
        Args: { p_id: string; p_lease_token: string; p_provider_config: Json }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_communication_attempt_without_release_guard: {
        Args: { p_id: string; p_lease_token: string; p_provider_config: Json }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_communication_attempt_without_reminder_guard: {
        Args: { p_id: string; p_lease_token: string; p_provider_config: Json }
        Returns: {
          accepted_at: string | null
          attachment_ids: string[]
          attempt_count: number
          attempt_started_at: string | null
          body: string
          channel: string
          client_id: string
          conversation_id: string
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_failure_kind: string | null
          first_attempt_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_id: string
          provider: string
          provider_config: Json | null
          provider_message_id: string | null
          recipient: string
          request_id: string
          revision: number
          state: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_reminder_scheduler_run: {
        Args: { p_limit: number; p_run_id: string }
        Returns: Json
      }
      stripe_event_retry_hash: {
        Args: { p_receipt_id: string }
        Returns: string
      }
      stripe_event_retry_target: {
        Args: { p_receipt_id: string }
        Returns: Json
      }
      suppress_communication: {
        Args: {
          p_actor_id: string
          p_channel: string
          p_reason: string
          p_recipient: string
        }
        Returns: undefined
      }
      transition_native_refill: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      update_conversation_metadata: {
        Args: {
          p_actor_id: string
          p_assigned_to_id: string
          p_conversation_id: string
          p_expected_revision: number
          p_priority: Database["public"]["Enums"]["conversation_priority"]
          p_status: Database["public"]["Enums"]["conversation_status"]
          p_tags: string[]
        }
        Returns: {
          archived_at: string | null
          assigned_to_id: string | null
          client_id: string
          created_at: string
          first_message_at: string | null
          first_response_at: string | null
          id: string
          is_read: boolean
          last_message_at: string
          priority: Database["public"]["Enums"]["conversation_priority"]
          revision: number
          status: Database["public"]["Enums"]["conversation_status"]
          tags: string[]
        }
        SetofOptions: {
          from: "*"
          to: "conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_website_inquiry: {
        Args: {
          p_actor_id: string
          p_assigned_to_id: string
          p_expected_version: number
          p_id: string
          p_reason: string
          p_status: string
        }
        Returns: {
          assigned_to_id: string | null
          client_id: string | null
          inquiry_id: string
          reply_channel: string | null
          reply_recipient: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "website_inquiry_triage"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verify_conversation_attachment: {
        Args: {
          p_actor_id: string
          p_byte_length: number
          p_id: string
          p_mime_type: string
          p_sha256: string
        }
        Returns: {
          actor_id: string
          byte_length: number
          conversation_id: string
          created_at: string
          file_name: string
          id: string
          mime_type: string
          sha256: string | null
          status: string
          storage_path: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "conversation_attachment_uploads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verify_release_source_original_legacy: {
        Args: { p_bytes: string; p_document: Json; p_snapshot: Json }
        Returns: undefined
      }
      verify_release_source_original_v5: {
        Args: { p_bytes: string; p_document: Json; p_snapshot: Json }
        Returns: undefined
      }
      void_billing_invoice: {
        Args: { p_expected_version: number; p_id: string; p_reason: string }
        Returns: {
          client_id: string
          created_at: string
          created_by: string
          currency: string
          id: string
          issued_at: string | null
          status: string
          total_cents: number | null
          version: number
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "billing_invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_patient_document: {
        Args: { p_expected_version: number; p_id: string; p_reason: string }
        Returns: {
          category: string
          created_at: string
          created_by: string
          document_date: string | null
          encounter_id: string | null
          file_name: string
          file_path: string
          file_size: number
          finalized_at: string | null
          id: string
          mime_type: string
          pet_id: string
          source: string
          status: string
          version: number
          visibility: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "patient_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_vaccine_certificate: {
        Args: { p_certificate_id: string; p_id: string; p_reason: string }
        Returns: {
          certificate_id: string
          created_at: string
          created_by: string
          id: string
          kind: string
          reason: string
          replacement_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "vaccine_certificate_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      website_inquiry_open_count: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      withdraw_native_estimate: {
        Args: { p_id: string; p_request: Json }
        Returns: Json
      }
      withdraw_record_release: {
        Args: { p_id: string; p_reason: string; p_release_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          reason: string
          release_id: string
        }
        SetofOptions: {
          from: "*"
          to: "record_release_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      appointment_status:
        "SCHEDULED" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW"
      call_type: "inbound" | "outbound" | "browser"
      callback_status:
        "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED"
      campaign_status:
        "DRAFT" | "SCHEDULED" | "SENDING" | "COMPLETED" | "CANCELLED"
      channel_type: "SMS" | "EMAIL" | "VOICE" | "VOICEMAIL"
      consent_method:
        "SMS_KEYWORD" | "WEB_FORM" | "VERBAL" | "WRITTEN" | "IMPORT"
      conversation_priority: "URGENT" | "NORMAL" | "LOW"
      conversation_status: "ACTIVE" | "PENDING" | "ARCHIVED"
      file_category:
        | "RECORD"
        | "LAB_RESULT"
        | "VACCINATION"
        | "XRAY"
        | "PRESCRIPTION"
        | "OTHER"
      follow_up_status: "PENDING" | "SENT" | "CANCELLED" | "FAILED"
      message_type:
        | "SMS"
        | "EMAIL"
        | "CALL_INBOUND"
        | "CALL_OUTBOUND"
        | "VOICEMAIL"
        | "SYSTEM"
        | "NOTE"
      outbound_delivery_status:
        | "QUEUED"
        | "LEASED"
        | "ACCEPTED"
        | "DELIVERED"
        | "FAILED"
        | "CANCELED"
        | "UNKNOWN"
      pet_sex: "MALE" | "FEMALE" | "UNKNOWN"
      refill_status: "REQUESTED" | "APPROVED" | "DENIED" | "READY" | "PICKED_UP"
      reminder_status: "PENDING" | "SENT" | "FAILED" | "SKIPPED" | "QUEUED"
      sender_type: "CLIENT" | "STAFF" | "SYSTEM"
      survey_status: "PENDING" | "SENT" | "COMPLETED" | "EXPIRED"
      survey_type: "NPS" | "STAR_RATING" | "THUMBS"
      ticket_form_type:
        "WELLNESS" | "ILLNESS" | "EUTHANASIA" | "HEALTH_CERTIFICATE"
      ticket_status: "OPEN" | "DVM_REVIEW" | "READY_FOR_SCHEDULING" | "CLOSED"
      user_role: "ADMIN" | "DVM" | "TECH" | "STAFF"
      waitlist_status:
        "WAITING" | "NOTIFIED" | "ACCEPTED" | "DECLINED" | "EXPIRED"
      wellness_reminder_status:
        "PENDING" | "SENT" | "ACKNOWLEDGED" | "CANCELLED"
      wellness_reminder_type: "VACCINE_DUE" | "ANNUAL_CHECKUP" | "DENTAL"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      appointment_status: [
        "SCHEDULED",
        "CONFIRMED",
        "CANCELLED",
        "COMPLETED",
        "NO_SHOW",
      ],
      call_type: ["inbound", "outbound", "browser"],
      callback_status: [
        "PENDING",
        "IN_PROGRESS",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
      ],
      campaign_status: [
        "DRAFT",
        "SCHEDULED",
        "SENDING",
        "COMPLETED",
        "CANCELLED",
      ],
      channel_type: ["SMS", "EMAIL", "VOICE", "VOICEMAIL"],
      consent_method: [
        "SMS_KEYWORD",
        "WEB_FORM",
        "VERBAL",
        "WRITTEN",
        "IMPORT",
      ],
      conversation_priority: ["URGENT", "NORMAL", "LOW"],
      conversation_status: ["ACTIVE", "PENDING", "ARCHIVED"],
      file_category: [
        "RECORD",
        "LAB_RESULT",
        "VACCINATION",
        "XRAY",
        "PRESCRIPTION",
        "OTHER",
      ],
      follow_up_status: ["PENDING", "SENT", "CANCELLED", "FAILED"],
      message_type: [
        "SMS",
        "EMAIL",
        "CALL_INBOUND",
        "CALL_OUTBOUND",
        "VOICEMAIL",
        "SYSTEM",
        "NOTE",
      ],
      outbound_delivery_status: [
        "QUEUED",
        "LEASED",
        "ACCEPTED",
        "DELIVERED",
        "FAILED",
        "CANCELED",
        "UNKNOWN",
      ],
      pet_sex: ["MALE", "FEMALE", "UNKNOWN"],
      refill_status: ["REQUESTED", "APPROVED", "DENIED", "READY", "PICKED_UP"],
      reminder_status: ["PENDING", "SENT", "FAILED", "SKIPPED", "QUEUED"],
      sender_type: ["CLIENT", "STAFF", "SYSTEM"],
      survey_status: ["PENDING", "SENT", "COMPLETED", "EXPIRED"],
      survey_type: ["NPS", "STAR_RATING", "THUMBS"],
      ticket_form_type: [
        "WELLNESS",
        "ILLNESS",
        "EUTHANASIA",
        "HEALTH_CERTIFICATE",
      ],
      ticket_status: ["OPEN", "DVM_REVIEW", "READY_FOR_SCHEDULING", "CLOSED"],
      user_role: ["ADMIN", "DVM", "TECH", "STAFF"],
      waitlist_status: [
        "WAITING",
        "NOTIFIED",
        "ACCEPTED",
        "DECLINED",
        "EXPIRED",
      ],
      wellness_reminder_status: [
        "PENDING",
        "SENT",
        "ACKNOWLEDGED",
        "CANCELLED",
      ],
      wellness_reminder_type: ["VACCINE_DUE", "ANNUAL_CHECKUP", "DENTAL"],
    },
  },
} as const
