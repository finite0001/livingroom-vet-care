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
          error_message: string | null
          id: string
          remind_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["reminder_status"]
        }
        Insert: {
          appointment_id: string
          appointment_version?: number
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          remind_at: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
        }
        Update: {
          appointment_id?: string
          appointment_version?: number
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          remind_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reminders_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
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
          amount_cents?: number | null
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
          amount_cents?: number | null
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
          audience_filter: Json
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
          audience_filter?: Json
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
          audience_filter?: Json
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
      consent_form_templates: {
        Row: {
          content_html: string
          created_at: string
          form_schema: Json
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          content_html?: string
          created_at?: string
          form_schema?: Json
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          content_html?: string
          created_at?: string
          form_schema?: Json
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
          form_data: Json
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
          form_data?: Json
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
          form_data?: Json
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
      contact_submissions: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          phone: string | null
          subject: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          phone?: string | null
          subject: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          phone?: string | null
          subject?: string
        }
        Relationships: []
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
          steps: Json
          trigger_ticket_types: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          steps?: Json
          trigger_ticket_types?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          steps?: Json
          trigger_ticket_types?: string[]
          updated_at?: string
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
          result_data: Json
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
          result_data?: Json
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
          result_data?: Json
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
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "outbound_message_attempts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
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
          request: Json
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
          request: Json
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
          request?: Json
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
            foreignKeyName: "refill_requests_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
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
          response_time_seconds?: number | null
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
          response_time_seconds?: number | null
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
            foreignKeyName: "response_metrics_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
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
          payload: Json
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
          payload: Json
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
          payload?: Json
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
            foreignKeyName: "communication_outbox_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
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
      communication_suppressions: {
        Row: {
          channel: string
          created_at: string
          created_by: string | null
          reason: string
          recipient: string
        }
        Insert: {
          channel: string
          created_at?: string
          created_by?: string | null
          reason: string
          recipient: string
        }
        Update: {
          channel?: string
          created_at?: string
          created_by?: string | null
          reason?: string
          recipient?: string
        }
        Relationships: []
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
          request: Json
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
          request: Json
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
          request?: Json
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
          teeth: Json
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
          teeth: Json
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
          teeth?: Json
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
          teeth: Json
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
          teeth?: Json
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
          teeth?: Json
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
      communication_inbound: {
        Row: {
          attachment_metadata: Json
          body: string
          channel: string
          client_id: string | null
          conversation_id: string | null
          event_id: string
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
          attachment_metadata?: Json
          body: string
          channel: string
          client_id?: string | null
          conversation_id?: string | null
          event_id: string
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
          attachment_metadata?: Json
          body?: string
          channel?: string
          client_id?: string | null
          conversation_id?: string | null
          event_id?: string
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
            foreignKeyName: "communication_inbound_assignments_inbound_id_fkey"
            columns: ["inbound_id"]
            isOneToOne: false
            referencedRelation: "communication_inbound"
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
      communication_provider_events: {
        Row: {
          attempts: number
          available_at: string
          event_id: string
          event_type: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          metadata: Json
          payload_hash: string
          provider: string
          received_at: string
          resource_id: string
          state: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          event_id: string
          event_type: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          metadata: Json
          payload_hash: string
          provider: string
          received_at?: string
          resource_id: string
          state?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          event_id?: string
          event_type?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          metadata?: Json
          payload_hash?: string
          provider?: string
          received_at?: string
          resource_id?: string
          state?: string
        }
        Relationships: []
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
            foreignKeyName: "conversation_read_cursors_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
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
      inbox_read_snapshots: {
        Row: {
          applied_at: string | null
          boundaries: Json
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          boundaries: Json
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          applied_at?: string | null
          boundaries?: Json
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
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
      lab_work_revisions: {
        Row: {
          actor_id: string
          entity: string
          entity_id: string
          id: number
          reason: string
          recorded_at: string
          snapshot: Json
          version: number
        }
        Insert: {
          actor_id: string
          entity: string
          entity_id: string
          id?: never
          reason: string
          recorded_at?: string
          snapshot: Json
          version: number
        }
        Update: {
          actor_id?: string
          entity?: string
          entity_id?: string
          id?: never
          reason?: string
          recorded_at?: string
          snapshot?: Json
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
          request: Json
          signature_name: string
          snapshot: Json
        }
        Insert: {
          attestation: string
          id: string
          issued_at?: string
          issued_by: string
          kind: string
          pet_id: string
          replaces_id?: string | null
          request: Json
          signature_name: string
          snapshot: Json
        }
        Update: {
          attestation?: string
          id?: string
          issued_at?: string
          issued_by?: string
          kind?: string
          pet_id?: string
          replaces_id?: string | null
          request?: Json
          signature_name?: string
          snapshot?: Json
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
          snapshot: Json
          version: number
        }
        Insert: {
          actor_id: string
          id?: never
          record_id: string
          recorded_at?: string
          snapshot: Json
          version: number
        }
        Update: {
          actor_id?: string
          id?: never
          record_id?: string
          recorded_at?: string
          snapshot?: Json
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
      patient_anesthesia_records: {
        Row: {
          assessment: string
          created_at: string
          created_by: string
          ended_at: string | null
          events: Json
          id: string
          observations: Json
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
        Insert: {
          assessment?: string
          created_at?: string
          created_by: string
          ended_at?: string | null
          events?: Json
          id: string
          observations?: Json
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
          events?: Json
          id?: string
          observations?: Json
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
          snapshot: Json
          version: number
        }
        Insert: {
          actor_id: string
          entity: string
          entity_id: string
          id?: never
          recorded_at?: string
          snapshot: Json
          version: number
        }
        Update: {
          actor_id?: string
          entity?: string
          entity_id?: string
          id?: never
          recorded_at?: string
          snapshot?: Json
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
          source_snapshot: Json
          source_version: number
          status: string
          template_snapshot: Json
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
          source_snapshot: Json
          source_version: number
          status?: string
          template_snapshot: Json
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
          source_snapshot?: Json
          source_version?: number
          status?: string
          template_snapshot?: Json
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
          template_snapshot: Json
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
          template_snapshot: Json
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
          template_snapshot?: Json
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
          payload: Json
          request_id: string
          submission_id: string
        }
        Insert: {
          capability_hash: string
          created_at?: string
          payload: Json
          request_id: string
          submission_id: string
        }
        Update: {
          capability_hash?: string
          created_at?: string
          payload?: Json
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
          reviewed_values: Json
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
          reviewed_values: Json
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
          reviewed_values?: Json
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      prepare_ezyvet_history_approval: {
        Args: { p_id: string; p_payload: Json; p_pet_id: string }
        Returns: Json
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
      prepare_ezyvet_problem_extraction: {
        Args: { p_id: string; p_payload: Json; p_pet_id: string }
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
      prepare_ezyvet_history_discrepancy: {
        Args: { p_id: string; p_payload: Json; p_pet_id: string }
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
      recover_ezyvet_history_request: {
        Args: { p_id: string; p_kind: string; p_pet_id: string }
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
      list_patient_imported_histories: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_pet_id: string
        }
        Returns: Json
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
      read_patient_problem_import_provenance: {
        Args: { p_pet_id: string; p_problem_ids: string[] }
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
      list_record_release_sources_v6: {
        Args: { p_offset?: number; p_pet_id: string }
        Returns: Json
      }
      select_all_record_release_sources_v6: {
        Args: { p_pet_id: string }
        Returns: Json
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
      recover_ezyvet_clinical_run: {
        Args: { p_animal_link_id: string; p_id: string; p_resource: string }
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
      list_record_release_sources_v5: {
        Args: { p_offset?: number; p_pet_id: string }
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
      select_all_record_release_sources_v5: {
        Args: { p_pet_id: string }
        Returns: Json
      }
      read_invoice_document: {
        Args: { p_invoice_id: string; p_client_id: string }
        Returns: Json
      }
      current_sms_consent: { Args: { p_client_id: string }; Returns: Json }
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
      apply_retention_policies: { Args: never; Returns: undefined }
      clinical_require_staff: { Args: never; Returns: string }
      clock_in: {
        Args: never
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
        Args: never
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
      delete_conversation_cascade: {
        Args: { conv_id: string }
        Returns: undefined
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
      get_consent_submission: {
        Args: { p_token: string }
        Returns: {
          access_token: string
          client_id: string
          conversation_id: string | null
          created_at: string
          expires_at: string
          form_data: Json
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
        Args: never
        Returns: {
          dvm_id: string
          dvm_name: string
          phone_number: string
          schedule_id: string
        }[]
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["user_role"]
          _user_id: string
        }
        Returns: boolean
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
      patient_document_storage_read: {
        Args: { p_path: string }
        Returns: boolean
      }
      patient_document_storage_write: {
        Args: { p_path: string }
        Returns: boolean
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
      process_due_reminders: {
        Args: never
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
          request: Json
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
      save_appointment: {
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
      schedule_clinicians: {
        Args: never
        Returns: {
          full_name: string
          id: string
        }[]
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
      create_inventory_product: {
        Args: {
          p_id: string;
          p_kind: string;
          p_manufacturer: string;
          p_name: string;
          p_unit: string;
          p_unit_price_cents: number;
        };
        Returns: {
          active: boolean;
          created_at: string;
          created_by: string;
          id: string;
          kind: string;
          manufacturer: string;
          name: string;
          unit: string;
          unit_price_cents: number;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "catalog_products";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      inventory_lot_balances: {
        Args: { p_limit?: number; p_product_id?: string; p_search?: string };
        Returns: {
          active: boolean;
          balance: number;
          expires_on: string;
          id: string;
          kind: string;
          location: string;
          lot_number: string;
          product_id: string;
          product_name: string;
          unit: string;
        }[];
      };
      search_inventory_products: {
        Args: { p_limit?: number; p_search?: string };
        Returns: {
          active: boolean;
          created_at: string;
          created_by: string;
          id: string;
          kind: string;
          manufacturer: string;
          name: string;
          unit: string;
          unit_price_cents: number;
          version: number;
        }[];
        SetofOptions: {
          from: "*";
          to: "catalog_products";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
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
      ezyvet_is_active_admin: { Args: { p_actor: string }; Returns: boolean }
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
      claim_communication: {
        Args: never
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
      communication_is_suppressed: {
        Args: { p_channel: string; p_client_id: string; p_recipient: string }
        Returns: boolean
      }
      communication_recipient: {
        Args: { p_channel: string; p_recipient: string }
        Returns: string
      }
      communication_require_service: { Args: never; Returns: undefined }
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
      record_communication_delivery: {
        Args: {
          p_event_id: string
          p_outcome: string
          p_provider: string
          p_provider_message_id: string
        }
        Returns: undefined
      }
      release_communication_claim: {
        Args: { p_error_code: string; p_id: string; p_lease_token: string }
        Returns: undefined
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
      suppress_communication: {
        Args: {
          p_actor_id: string
          p_channel: string
          p_reason: string
          p_recipient: string
        }
        Returns: undefined
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
          request: Json
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
          teeth: Json
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
          teeth: Json
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
          attachment_metadata: Json
          body: string
          channel: string
          client_id: string | null
          conversation_id: string | null
          event_id: string
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
      claim_communication_event: {
        Args: never
        Returns: {
          attempts: number
          available_at: string
          event_id: string
          event_type: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          metadata: Json
          payload_hash: string
          provider: string
          received_at: string
          resource_id: string
          state: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_provider_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_communication_status: {
        Args: { p_event_id: string; p_lease_token: string }
        Returns: undefined
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
          attachment_metadata: Json
          body: string
          channel: string
          client_id: string | null
          conversation_id: string | null
          event_id: string
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
      mark_conversation_read: {
        Args: {
          p_actor_id: string
          p_conversation_id: string
          p_message_id: string
        }
        Returns: undefined
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
          event_id: string
          event_type: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          metadata: Json
          payload_hash: string
          provider: string
          received_at: string
          resource_id: string
          state: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_provider_events"
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
      release_communication_event: {
        Args: {
          p_error: string
          p_id: string
          p_lease_token: string
          p_review?: boolean
        }
        Returns: undefined
      }
      apply_inbox_read_snapshot: {
        Args: { p_actor_id: string; p_snapshot_id: string }
        Returns: undefined
      }
      capture_inbox_read_snapshot: { Args: never; Returns: string }
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
      inbox_unread_totals: {
        Args: never
        Returns: {
          unread_conversations: number
          unread_messages: number
        }[]
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
      mark_conversation_unread: {
        Args: { p_actor_id: string; p_conversation_id: string }
        Returns: undefined
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
      certificate_require_issuer: {
        Args: never
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
          request: Json
          signature_name: string
          snapshot: Json
        }
        SetofOptions: {
          from: "*"
          to: "vaccine_certificates"
          isOneToOne: true
          isSetofReturn: false
        }
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
      read_vaccine_certificate: { Args: { p_id: string }; Returns: Json }
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
      anesthesia_validate: {
        Args: {
          p_record: Database["public"]["Tables"]["patient_anesthesia_records"]["Row"]
        }
        Returns: undefined
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
          events: Json
          id: string
          observations: Json
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
      sign_patient_anesthesia_record: {
        Args: { p_expected_version: number; p_id: string; p_pet_id: string }
        Returns: {
          assessment: string
          created_at: string
          created_by: string
          ended_at: string | null
          events: Json
          id: string
          observations: Json
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
      list_inbound_message_attachments: {
        Args: { p_message_ids: string[] }
        Returns: Json
      }
      list_conversation_message_attachments: {
        Args: { p_message_ids: string[] }
        Returns: { message_id: string; request_id: string; payload_hash: string; files: Json }[]
      }
      read_conversation_message_attachment: {
        Args: { p_message_id: string; p_upload_id: string; p_payload_hash: string }
        Returns: Json
      }
      read_conversation_email_attachment: {
        Args: { p_request_id: string; p_upload_id: string; p_payload_hash: string }
        Returns: Json
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
      recover_message_request: {
        Args: { p_actor_id: string; p_request_id?: string; p_scope: string }
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
      care_require_admin: { Args: never; Returns: string }
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
          source_snapshot: Json
          source_version: number
          status: string
          template_snapshot: Json
        }
        SetofOptions: {
          from: "*"
          to: "care_reminder_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
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
          template_snapshot: Json
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
      authorize_website_inquiry_reply: {
        Args: { p_actor_id: string; p_expected_version: number; p_id: string }
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
      read_website_inquiry: { Args: { p_id: string }; Returns: Json }
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
      website_inquiry_open_count: { Args: never; Returns: number }
      accept_contact_intake: {
        Args: {
          p_capability_hash: string
          p_email_budget_hash: string
          p_payload: Json
          p_request_id: string
        }
        Returns: Json
      }
      consume_contact_intake_budget: { Args: never; Returns: boolean }
      contact_intake_receipt: {
        Args: { p_capability_hash: string; p_request_id: string }
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
          reviewed_values: Json
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
      list_ezyvet_weight_candidates: {
        Args: {
          p_animal_link_id: string
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: Json[]
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
      resolve_ezyvet_weight_request: {
        Args: {
          p_discard: boolean
          p_request_id: string
          p_snapshot_id: string
        }
        Returns: Json
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
    }
    Enums: {
      appointment_status:
        | "SCHEDULED"
        | "CONFIRMED"
        | "CANCELLED"
        | "COMPLETED"
        | "NO_SHOW"
      call_type: "inbound" | "outbound" | "browser"
      callback_status:
        | "PENDING"
        | "IN_PROGRESS"
        | "COMPLETED"
        | "FAILED"
        | "CANCELLED"
      campaign_status:
        | "DRAFT"
        | "SCHEDULED"
        | "SENDING"
        | "COMPLETED"
        | "CANCELLED"
      channel_type: "SMS" | "EMAIL" | "VOICE" | "VOICEMAIL"
      consent_method:
        | "SMS_KEYWORD"
        | "WEB_FORM"
        | "VERBAL"
        | "WRITTEN"
        | "IMPORT"
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
      pet_sex: "MALE" | "FEMALE" | "UNKNOWN"
      refill_status: "REQUESTED" | "APPROVED" | "DENIED" | "READY" | "PICKED_UP"
      reminder_status: "PENDING" | "SENT" | "FAILED" | "SKIPPED"
      sender_type: "CLIENT" | "STAFF" | "SYSTEM"
      survey_status: "PENDING" | "SENT" | "COMPLETED" | "EXPIRED"
      survey_type: "NPS" | "STAR_RATING" | "THUMBS"
      ticket_form_type:
        | "WELLNESS"
        | "ILLNESS"
        | "EUTHANASIA"
        | "HEALTH_CERTIFICATE"
      ticket_status: "OPEN" | "DVM_REVIEW" | "READY_FOR_SCHEDULING" | "CLOSED"
      user_role: "ADMIN" | "DVM" | "TECH" | "STAFF"
      waitlist_status:
        | "WAITING"
        | "NOTIFIED"
        | "ACCEPTED"
        | "DECLINED"
        | "EXPIRED"
      wellness_reminder_status:
        | "PENDING"
        | "SENT"
        | "ACKNOWLEDGED"
        | "CANCELLED"
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
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
      pet_sex: ["MALE", "FEMALE", "UNKNOWN"],
      refill_status: ["REQUESTED", "APPROVED", "DENIED", "READY", "PICKED_UP"],
      reminder_status: ["PENDING", "SENT", "FAILED", "SKIPPED"],
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
