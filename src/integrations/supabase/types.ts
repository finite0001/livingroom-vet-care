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
    PostgrestVersion: "14.1"
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
          appointment_type: string
          assigned_dvm_id: string | null
          client_id: string
          created_at: string
          duration_minutes: number
          ezyvet_appointment_id: string | null
          id: string
          notes: string | null
          pet_id: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          appointment_type: string
          assigned_dvm_id?: string | null
          client_id: string
          created_at?: string
          duration_minutes?: number
          ezyvet_appointment_id?: string | null
          id?: string
          notes?: string | null
          pet_id?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          appointment_type?: string
          assigned_dvm_id?: string | null
          client_id?: string
          created_at?: string
          duration_minutes?: number
          ezyvet_appointment_id?: string | null
          id?: string
          notes?: string | null
          pet_id?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
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
          id: string
          last_name: string
          preferred_channel: Database["public"]["Enums"]["channel_type"] | null
          primary_email: string | null
          primary_phone: string | null
        }
        Insert: {
          created_at?: string
          ezyvet_id?: string | null
          first_name: string
          full_name: string
          id?: string
          last_name: string
          preferred_channel?: Database["public"]["Enums"]["channel_type"] | null
          primary_email?: string | null
          primary_phone?: string | null
        }
        Update: {
          created_at?: string
          ezyvet_id?: string | null
          first_name?: string
          full_name?: string
          id?: string
          last_name?: string
          preferred_channel?: Database["public"]["Enums"]["channel_type"] | null
          primary_email?: string | null
          primary_phone?: string | null
        }
        Relationships: []
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
          breed: string | null
          client_id: string
          created_at: string
          dob: string | null
          id: string
          last_visit_at: string | null
          medications: string | null
          microchip_id: string | null
          name: string
          species: string
          vaccination_notes: string | null
          weight_lbs: number | null
        }
        Insert: {
          allergies?: string | null
          breed?: string | null
          client_id: string
          created_at?: string
          dob?: string | null
          id?: string
          last_visit_at?: string | null
          medications?: string | null
          microchip_id?: string | null
          name: string
          species: string
          vaccination_notes?: string | null
          weight_lbs?: number | null
        }
        Update: {
          allergies?: string | null
          breed?: string | null
          client_id?: string
          created_at?: string
          dob?: string | null
          id?: string
          last_visit_at?: string | null
          medications?: string | null
          microchip_id?: string | null
          name?: string
          species?: string
          vaccination_notes?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      delete_conversation_cascade: {
        Args: { conv_id: string }
        Returns: undefined
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
