package com.origin.osd;
import android.app.*; import android.os.*; import android.content.*; import android.net.Uri; import android.view.*; import android.widget.*;
public class MainActivity extends Activity {
 LinearLayout root; TextView status;
 public void onCreate(Bundle b){super.onCreate(b); root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(32,40,32,32);
 TextView title=new TextView(this);title.setText("OSD 1.20.0");title.setTextSize(28);root.addView(title);
 status=new TextView(this);status.setText("READY — real OSD engine");root.addView(status);
 Button pick=new Button(this);pick.setText("Choose media");pick.setOnClickListener(v->{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.setType("audio/*");i.addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(i,7);});root.addView(pick);
 setContentView(root);}
}