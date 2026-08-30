// Deterministic offline quota-preserving search for the 160-row balance covering design.
#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <random>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
using namespace std;

struct Row { array<int,10> c; int split; bool authored; uint64_t mask; };
struct Obj { int pairDef=0,vpairDef=0,priDef=0,vpriDef=0,reqDef=0,vreqDef=0,routeDef=0,vrouteDef=0,uncovered=0,overlap6=0; long long pairSq=0; };

int main(int argc,char**argv){
 int iterations=argc>1?stoi(argv[1]):3000000; uint64_t seed=argc>2?stoull(argv[2]):12345; string mode=argc>3?argv[3]:"all";
 int n; if(!(cin>>n)) return 1; vector<string> names(40); unordered_map<string,int> id;
 for(int i=0;i<40;i++){cin>>names[i];id[names[i]]=i;}
 vector<Row> rows(n); for(auto &r:rows){cin>>r.split>>r.authored;r.mask=0;for(int&i:r.c){string s;cin>>s;i=id[s];r.mask|=1ULL<<i;}sort(r.c.begin(),r.c.end());}
 bool pri[40][40]{};int P;cin>>P;for(int z=0;z<P;z++){string a,b;cin>>a>>b;pri[id[a]][id[b]]=pri[id[b]][id[a]]=true;}
 vector<char> req(64000);vector<array<int,3>> reqList;int T;cin>>T;for(int z=0;z<T;z++){string a,b,c;cin>>a>>b>>c;array<int,3>x{id[a],id[b],id[c]};sort(x.begin(),x.end());req[x[0]*1600+x[1]*40+x[2]]=1;reqList.push_back(x);}
 auto mkset=[&](initializer_list<const char*> xs){unordered_set<int>s;for(auto x:xs)s.insert(id[x]);return s;};
 auto mana=mkset({"channel","leyStep","attune","prism","arcBolt","fireball","starfire","discharge","cascade","overload"});
 auto melee=mkset({"feint","jab","strike","drive","heavyBlow","openingStrike","rally","bullRush","flurry"});
 auto ranged=mkset({"aim","pepperingShot","steadyShot","repellingShot","longshot","volley","salvageShot","precisionShot"});
 auto source=mkset({"channel","leyStep","attune","prism"});
 auto payoff=mkset({"arcBolt","fireball","starfire","discharge","cascade","overload"});
 auto damage=mkset({"arcBolt","fireball","starfire","discharge","cascade","overload","jab","strike","drive","heavyBlow","openingStrike","rally","bullRush","flurry","pepperingShot","steadyShot","repellingShot","longshot","volley","salvageShot","precisionShot","discipline","improvise"});
 auto draw=mkset({"channel","attune","prism","feint","jab","aim","pepperingShot","salvageShot","footwork","stipend","reclaim","regroup","adapt","muster","regiment","sharpen","scour"});
 auto movement=mkset({"leyStep","drive","repellingShot","footwork"});
 auto economy=mkset({"stipend","reforge"}); auto trash=mkset({"discipline","cull","sharpen","reforge","scour"}); auto recovery=mkset({"reclaim"});
 unordered_map<int,int> cost; vector<int> costs={4,5,4,4,4,5,3,3,4,2,4,5,5,5,3,5,5,3,3,4,5,3,5,3,5,5,4,3,4,7,3,3,4,5,3,6,3,3,3,5};
 // costs correspond to sorted ids in the current input; verify names before use.
 vector<string> sortedExpected={"adapt","aim","arcBolt","attune","bullRush","cascade","channel","cull","discharge","discipline","drive","feint","fireball","flurry","footwork","heavyBlow","improvise","jab","leyStep","longshot","muster","openingStrike","overload","pepperingShot","precisionShot","prism","rally","reclaim","reforge","regiment","regroup","repellingShot","salvageShot","scour","sharpen","starfire","steadyShot","stipend","strike","volley"};
 if(names!=sortedExpected){cerr<<"card order mismatch\n";return 2;} for(int i=0;i<40;i++)cost[i]=costs[i];
 array<int,14> thresholds{16,12,16,12,8,4,8,8,16,4,8,16,4,16};
 auto labels=[&](const Row&r){array<char,14>L{};int md=0,xd=0,rd=0,ms=0,mp=0,dr=0,shape=0,hi=0,mv=0;bool fe=false,aim=false,stip=false,ref=false,imp=false;
  for(int x:r.c){if(mana.count(x)&&damage.count(x))md++;if(melee.count(x)&&damage.count(x))xd++;if(ranged.count(x)&&damage.count(x))rd++;ms+=source.count(x);mp+=payoff.count(x);dr+=draw.count(x);shape+=trash.count(x)||recovery.count(x)||economy.count(x);hi+=cost[x]>=5;mv+=movement.count(x);fe|=names[x]=="feint";aim|=names[x]=="aim";stip|=names[x]=="stipend";ref|=names[x]=="reforge";imp|=names[x]=="improvise";}
  L[0]=md&&xd&&rd;L[1]=shape>=3;L[2]=dr>=3;L[3]=hi>=3&&(stip||ref);L[4]=imp+0 && ((md>0)+(xd>0)+(rd>0)>=2);L[5]=count_if(r.c.begin(),r.c.end(),[&](int x){return mana.count(x);})>=5&&ms>=2&&mp>=2;L[6]=md>=2&&xd>=2;L[7]=md>=2&&rd>=2;L[8]=ms&&mp;L[9]=count_if(r.c.begin(),r.c.end(),[&](int x){return melee.count(x);})>=5&&xd>=4;L[10]=xd>=2&&rd>=2;L[11]=xd>=2&&(mv||fe);L[12]=count_if(r.c.begin(),r.c.end(),[&](int x){return ranged.count(x);})>=5&&rd>=4;L[13]=rd>=2&&(mv||aim);return L;};
 auto valid=[&](const Row&r){int dmg=0,sup=0,lo=0,hi=0;for(int x:r.c){dmg+=damage.count(x);sup+=draw.count(x)||economy.count(x)||trash.count(x)||recovery.count(x);lo+=cost[x]<=3;hi+=cost[x]>=5;}return dmg>=2&&sup>=1&&lo&&hi;};
 int pc[40][40]{},vpc[40][40]{};vector<int>tc(64000),vtc(64000);array<int,14>rc{},vrc{};Obj o;
 auto df=[](int x,int t){return max(0,t-x);};
 auto ap=[&](int a,int b,int d,bool val){if(a>b)swap(a,b);int old=pc[a][b],nw=old+d;o.pairDef+=df(nw,8)-df(old,8);o.pairSq+=1LL*nw*nw-1LL*old*old;if(pri[a][b])o.priDef+=df(nw,12)-df(old,12);pc[a][b]=nw;if(val){old=vpc[a][b];nw=old+d;o.vpairDef+=df(nw,1)-df(old,1);if(pri[a][b])o.vpriDef+=df(nw,2)-df(old,2);vpc[a][b]=nw;}};
 auto at=[&](int a,int b,int c,int d,bool val){array<int,3>x{a,b,c};sort(x.begin(),x.end());int k=x[0]*1600+x[1]*40+x[2],old=tc[k],nw=old+d;if(old==0&&nw>0)o.uncovered--;if(old>0&&nw==0)o.uncovered++;if(req[k])o.reqDef+=df(nw,4)-df(old,4);tc[k]=nw;if(val){old=vtc[k];nw=old+d;if(req[k])o.vreqDef+=df(nw,1)-df(old,1);vtc[k]=nw;}};
 auto ar=[&](const Row&r,int d){auto L=labels(r);for(int z=0;z<14;z++)if(L[z]){int old=rc[z],nw=old+d;o.routeDef+=df(nw,thresholds[z])-df(old,thresholds[z]);rc[z]=nw;if(r.split){old=vrc[z];nw=old+d;o.vrouteDef+=df(nw,1)-df(old,1);vrc[z]=nw;}}};
 auto adjust=[&](const Row&r,int d){for(int a=0;a<10;a++)for(int b=a+1;b<10;b++)ap(r.c[a],r.c[b],d,r.split);for(int a=0;a<10;a++)for(int b=a+1;b<10;b++)for(int c=b+1;c<10;c++)at(r.c[a],r.c[b],r.c[c],d,r.split);ar(r,d);};
 o.pairDef=780*8;o.vpairDef=780;o.priDef=96*12;o.vpriDef=96*2;o.reqDef=60*4;o.vreqDef=60;o.routeDef=0;o.vrouteDef=14;for(int z=0;z<14;z++)o.routeDef+=thresholds[z];o.uncovered=9880;for(auto&r:rows)adjust(r,1);for(int i=0;i<n;i++)for(int j=i+1;j<n;j++)if(popcount(rows[i].mask&rows[j].mask)==6)o.overlap6++;
 auto score=[&](){int tripleShort=max(0,o.uncovered-(9880-9090)),ov=max(0,o.overlap6-127);if(mode=="validation")return 500000.0*o.vpairDef+200000.0*o.vpriDef+200000.0*o.vreqDef+200000.0*o.vrouteDef+100000.0*ov+.1*o.overlap6;if(mode=="tuning")return 500000.0*o.pairDef+300000.0*o.priDef+2000000.0*o.reqDef+500000.0*o.routeDef+500.0*tripleShort+1.0*o.uncovered+100000.0*ov+.1*o.overlap6;return 200000.0*o.pairDef+400000.0*o.vpairDef+20000.0*o.priDef+200000.0*o.vpriDef+10000.0*o.reqDef+200000.0*o.vreqDef+50000.0*o.routeDef+200000.0*o.vrouteDef+200.0*tripleShort+1.0*o.uncovered+.01*o.pairSq+200000.0*ov+.1*o.overlap6;};
 auto passes=[&](){if(mode=="validation")return o.vpairDef==0&&o.vpriDef==0&&o.vreqDef==0&&o.vrouteDef==0&&o.overlap6<=127;if(mode=="tuning")return o.pairDef==0&&o.priDef==0&&o.reqDef==0&&o.routeDef==0&&o.uncovered<=790&&o.overlap6<=127;return o.pairDef==0&&o.vpairDef==0&&o.priDef==0&&o.vpriDef==0&&o.reqDef==0&&o.vreqDef==0&&o.routeDef==0&&o.vrouteDef==0&&o.uncovered<=790&&o.overlap6<=127;};
 auto print=[&](int it){cerr<<it<<" score "<<score()<<" p "<<o.pairDef<<"/"<<o.vpairDef<<" pri "<<o.priDef<<"/"<<o.vpriDef<<" req "<<o.reqDef<<"/"<<o.vreqDef<<" route "<<o.routeDef<<"/"<<o.vrouteDef<<" cov "<<9880-o.uncovered<<" ov6 "<<o.overlap6<<(passes()?" PASS":"")<<"\n";};
 mt19937_64 rng(seed);uniform_real_distribution<double>U(0,1);vector<int>genT,genV;for(int i=0;i<n;i++)if(!rows[i].authored)(rows[i].split?genV:genT).push_back(i);
 vector<Row>best=rows;Obj bestO=o;double bestS=score();bool found=passes();print(0);
 auto pickDefPair=[&](bool val,bool priority)->pair<int,int>{vector<pair<int,int>>v;for(int a=0;a<40;a++)for(int b=a+1;b<40;b++){int target=priority? (val?2:12):(val?1:8);int cur=val?vpc[a][b]:pc[a][b];if((!priority||pri[a][b])&&cur<target)v.push_back({a,b});}if(v.empty())return{-1,-1};return v[rng()%v.size()];};
 auto propose=[&](int stage,int &li,int&ri,int&lx,int&rx){bool val=false;pair<int,int>target{-1,-1};if(stage<4){val=stage%2;target=pickDefPair(val,stage>=2);}else if(stage==5||stage==6)val=stage==6;vector<int>&pool=(mode=="validation"||val)?genV:genT;if(pool.size()<2)return false;
  if(target.first>=0){int a=target.first,b=target.second;vector<int>A,B;for(int i:pool){bool ha=rows[i].mask>>a&1,hb=rows[i].mask>>b&1;if(ha&&!hb)A.push_back(i);if(hb&&!ha)B.push_back(i);}if(A.empty()||B.empty())return false;li=A[rng()%A.size()];ri=B[rng()%B.size()];if(li==ri)return false;rx=b;vector<int>X;for(int x:rows[li].c)if(x!=a&&!(rows[ri].mask>>x&1))X.push_back(x);if(X.empty())return false;lx=X[rng()%X.size()];return true;}
  if(stage==5||stage==6){vector<array<int,3>> need;for(auto t:reqList){int k=t[0]*1600+t[1]*40+t[2],cur=val?vtc[k]:tc[k];if(cur<(val?1:4))need.push_back(t);}if(need.empty())return false;auto t=need[rng()%need.size()];vector<pair<int,int>> A;for(int i:pool){int have=0;for(int x:t)have+=(rows[i].mask>>x)&1;if(have==2)A.push_back({i,have});}if(A.empty())return false;li=A[rng()%A.size()].first;int missing=-1;for(int x:t)if(!((rows[li].mask>>x)&1))missing=x;vector<int>B;for(int i:pool)if(i!=li&&((rows[i].mask>>missing)&1)){int other=0;for(int x:t)if(x!=missing)other+=(rows[i].mask>>x)&1;if(!other)B.push_back(i);}if(B.empty())return false;ri=B[rng()%B.size()];rx=missing;vector<int>X;for(int x:rows[li].c)if(find(t.begin(),t.end(),x)==t.end()&&!((rows[ri].mask>>x)&1))X.push_back(x);if(X.empty())return false;lx=X[rng()%X.size()];return true;}
  li=pool[rng()%pool.size()];ri=pool[rng()%pool.size()];if(li==ri)return false;vector<int>X,Y;for(int x:rows[li].c)if(!(rows[ri].mask>>x&1))X.push_back(x);for(int y:rows[ri].c)if(!(rows[li].mask>>y&1))Y.push_back(y);if(X.empty()||Y.empty())return false;lx=X[rng()%X.size()];rx=Y[rng()%Y.size()];return true;};
 for(int it=1;it<=iterations;it++){int stage;if(mode=="validation"){if(o.vpairDef)stage=1;else if(o.vpriDef)stage=3;else if(o.vreqDef)stage=6;else stage=4;}else if(mode=="tuning"){if(o.pairDef)stage=0;else if(o.priDef)stage=2;else if(o.reqDef)stage=5;else stage=4;}else if(o.pairDef||o.vpairDef)stage=(o.vpairDef&&rng()%2)?1:0;else if(o.priDef||o.vpriDef)stage=(o.vpriDef&&rng()%2)?3:2;else if(o.reqDef||o.vreqDef)stage=(o.vreqDef&&rng()%2)?6:5;else stage=4; if(rng()%10<2)stage=4;int li,ri,lx,rx;if(!propose(stage,li,ri,lx,rx))continue;Row L=rows[li],R=rows[ri],NL=L,NR=R;for(int&i:NL.c)if(i==lx){i=rx;break;}for(int&i:NR.c)if(i==rx){i=lx;break;}sort(NL.c.begin(),NL.c.end());sort(NR.c.begin(),NR.c.end());NL.mask=(L.mask&~(1ULL<<lx))|(1ULL<<rx);NR.mask=(R.mask&~(1ULL<<rx))|(1ULL<<lx);if(!valid(NL)||!valid(NR)||NL.mask==NR.mask)continue;bool bad=false;int newOv=o.overlap6;for(int z=0;z<n;z++)if(z!=li&&z!=ri){int ol=popcount(L.mask&rows[z].mask),orr=popcount(R.mask&rows[z].mask),nl=popcount(NL.mask&rows[z].mask),nr=popcount(NR.mask&rows[z].mask);if(nl>6||nr>6){bad=true;break;}newOv+=(nl==6)+(nr==6)-(ol==6)-(orr==6);}if(bad)continue;
  double before=score();adjust(L,-1);adjust(R,-1);rows[li]=NL;rows[ri]=NR;adjust(NL,1);adjust(NR,1);int oldOv=o.overlap6;o.overlap6=newOv;double after=score();double progress=(double)it/iterations,temp=50000*pow(0.0002,progress);bool accept=after<=before||U(rng)<exp((before-after)/max(1.0,temp));if(!accept){adjust(NL,-1);adjust(NR,-1);rows[li]=L;rows[ri]=R;adjust(L,1);adjust(R,1);o.overlap6=oldOv;}else if(after<bestS || (passes()&&!found)){bestS=after;best=rows;bestO=o;found|=passes();if(it%1000==0||passes())print(it);if(passes()&&o.uncovered<700)break;}if(it%500000==0)print(it);
 }
 rows=best;o=bestO;print(iterations);cout<<n<<"\n";for(auto&r:rows){cout<<r.split<<" "<<r.authored;for(int x:r.c)cout<<" "<<names[x];cout<<"\n";}return passes()?0:3;
}
